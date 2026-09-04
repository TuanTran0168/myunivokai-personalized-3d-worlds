"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Save, UserRound } from "lucide-react";
import { StatusMessage } from "@/components/StatusMessage";
import { ReturnDestinationLinks } from "@/components/ReturnDestinationLinks";
import { Toast, type ToastTone } from "@/components/Toast";
import { AmbientBackdrop } from "@/components/AmbientBackdrop";
import { ChipGroupWithCustom } from "@/components/ChipGroupWithCustom";
import { SwatchChipGroup } from "@/components/SwatchChipGroup";
import { PREVIEW_REBUILD_DEBOUNCE_MILLISECONDS, useDebouncedValue } from "@/lib/useDebouncedValue";
import {
  ACCOUNT_GENDERS,
  ACCOUNT_GENDER_LABELS,
  EMPTY_ACCOUNT_PROFILE,
  fetchAccountProfile,
  saveAccountProfile,
  type AccountGender,
  type AccountProfile
} from "@/lib/accountProfile";
import { readProductAccount, writeProductAccount } from "@/lib/productSession";
import {
  COLOR_OPTIONS,
  CREATE_FORM_INITIAL_VALUES,
  FAMILY_COPY,
  FAMILY_OPTIONS,
  INTEREST_OPTIONS,
  MAXIMUM_CHALLENGE_LENGTH,
  MAXIMUM_CUSTOM_CHIP_CHARACTERS,
  MAXIMUM_FAVORITE_COLORS,
  MAXIMUM_GOAL_LENGTH,
  MAXIMUM_INTERESTS,
  MAXIMUM_ROLE_LENGTH,
  MAXIMUM_TRAITS,
  MINIMUM_CUSTOM_CHIP_CHARACTERS,
  MINIMUM_FAVORITE_COLORS,
  MINIMUM_INTERESTS,
  MINIMUM_TRAITS,
  TRAIT_OPTIONS,
  defaultStyleForFamily
} from "@/features/world-form/worldFormOptions";
import { createFormValuesFromProfile, profileWithCreateFormDefaults } from "@/features/world-form/profileAutofill";
import { buildCreateFormPreviewScene } from "@/features/world-form/previewScene";
import type { WorldFamily } from "@/lib/types";
import { toggleItem } from "@/lib/formSelection";
import {
  MAXIMUM_DISPLAY_NAME_LENGTH,
  failureStateFor,
  wakingMessage,
  type AuthCredentialsFormStatus
} from "./authCredentialsFormState";
import { announceProductSessionChanged, useProductSession } from "./useProductSession";

/**
 * The world-field bounds are imported from worldFormOptions rather than
 * written out again here, so this page and the create form cannot disagree
 * about what a world field may hold.
 *
 * This one is an account field rather than a world field, so it has no
 * counterpart there.
 */
const MAXIMUM_FULL_NAME_LENGTH = 120;

/**
 * The chip groups mirror the create form's MINIMUMS as well as its ceilings,
 * on the owner's instruction and for a concrete reason: these fields end up in
 * that form, and a profile saved with one interest produces a create form
 * sitting below its own floor with no way for the person in front of it to
 * tell why.
 *
 * That only works because `profileWithCreateFormDefaults` fills an unanswered
 * list with what the create form opens with, so the floor is already met the
 * first time this page is opened. The server stays permissive
 * (`ValidateAsCreationDefaults` has no minimums): it bounds what may be
 * STORED, and a row written before this rule still has to load.
 */

/** "No family chosen" — a valid saved state, and the value the select holds for it. */
const NO_PREFERRED_FAMILY = "";

export function AccountProfileForm() {
  const { sessionState } = useProductSession();
  // Passed to ReturnDestinationLinks rather than written out as "/account", so
  // this page does not hold a second copy of its own route and the links never
  // offer the page they are on.
  const currentPath = usePathname();
  const [profile, setProfile] = useState<AccountProfile>(() => profileWithCreateFormDefaults(EMPTY_ACCOUNT_PROFILE));
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<AuthCredentialsFormStatus>({ kind: "idle" });
  /**
   * The one message about something that has already finished. Held rather
   * than derived from `status` because it outlives it: the save is over and
   * idle again while the confirmation is still on screen.
   */
  const [toast, setToast] = useState<{ tone: ToastTone; message: string } | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  const isSignedIn = sessionState.status === "signed-in";

  useEffect(() => {
    if (!isSignedIn) {
      // Not an error state: the session may simply still be unknown on the
      // first render, which is why AccountMenu renders nothing then too.
      setIsLoading(sessionState.status === "unknown");
      return;
    }
    let isMounted = true;
    fetchAccountProfile({
      onServiceWaking: (attemptNumber) => {
        if (isMounted) {
          setStatus({ kind: "waking", attemptNumber });
        }
      }
    })
      .then((loadedProfile) => {
        if (!isMounted) {
          return;
        }
        setProfile(profileWithCreateFormDefaults(loadedProfile));
        setStatus({ kind: "idle" });
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setStatus(failureStateFor(error));
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [isSignedIn, sessionState.status]);

  const updateProfile = useCallback((change: Partial<AccountProfile>) => {
    setProfile((current) => ({ ...current, ...change }));
  }, []);

  const updateCreationDefaults = useCallback((change: Partial<AccountProfile["creationDefaults"]>) => {
    setProfile((current) => ({ ...current, creationDefaults: { ...current.creationDefaults, ...change } }));
  }, []);

  /**
   * Changing the family swaps the style with the new family's neutral one, the
   * same rule the create page follows: a style belongs to exactly one family,
   * so keeping "nebula" while switching to the forest would save a value the
   * generate call refuses.
   *
   * Clearing the family clears the style, because a style with no family
   * behind it is what the gateway rejects with "choose a world family first".
   */
  const changeFamily = useCallback((nextFamily: WorldFamily | "") => {
    setProfile((current) => ({
      ...current,
      preferredWorldFamily: nextFamily,
      creationDefaults: {
        ...current.creationDefaults,
        preferredWorldStyle: nextFamily === NO_PREFERRED_FAMILY ? "" : defaultStyleForFamily(nextFamily)
      }
    }));
  }, []);

  /**
   * The world behind this page: the one the create form would open with, built
   * from the profile as it stands on screen rather than as it was last saved.
   *
   * This is the answer to a setting that used to do nothing visible. Choosing
   * a preferred family filled a select and left the page exactly as it was, so
   * there was no way to tell a saved preference from a discarded one without
   * navigating away and back. Now the world changes as you choose.
   *
   * Debounced for the same reason the create page's preview is: rebuilding a
   * WebGL scene on every keystroke in the goal field would tear the GL context
   * down and back up per character.
   */
  const debouncedProfile = useDebouncedValue(profile, PREVIEW_REBUILD_DEBOUNCE_MILLISECONDS);
  const backdropScene = useMemo(
    // Against CREATE_FORM_INITIAL_VALUES, so an unanswered field shows what the
    // create form shows for it — the backdrop is a preview of that form, not of
    // the profile row.
    () => buildCreateFormPreviewScene(createFormValuesFromProfile(debouncedProfile, CREATE_FORM_INITIAL_VALUES)),
    [debouncedProfile]
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setStatus({ kind: "submitting" });
      setToast(null);
      try {
        const savedProfile = await saveAccountProfile(profile, {
          onServiceWaking: (attemptNumber) => setStatus({ kind: "waking", attemptNumber })
        });
        setProfile(profileWithCreateFormDefaults(savedProfile));
        // The header greets people by this name, and it lives in a separate
        // storage key from the profile. Without this the menu keeps the old
        // name until the next sign-in, which reads as the save not working.
        const storedAccount = readProductAccount();
        if (storedAccount) {
          writeProductAccount({ ...storedAccount, name: savedProfile.displayName });
          announceProductSessionChanged();
        }
        setStatus({ kind: "idle" });
        setToast({
          tone: "success",
          // The confirmation says what was actually agreed to. With the switch
          // off, "your next world starts from it" would be a promise the page
          // has just been told not to keep.
          message: savedProfile.autofillCreateForm
            ? "Profile saved. Your next world starts from it."
            : "Profile saved. Filling the create form is off, so only your name will be used."
        });
      } catch (error) {
        const failure = failureStateFor(error);
        setStatus(failure);
        // The failure is a toast AND the inline message below, on purpose: the
        // toast is what somebody looking anywhere else on a long form will
        // see, and the inline one is what is still there when they come back
        // to the button that failed.
        setToast({ tone: "error", message: failure.kind === "failed" ? failure.message : "Could not save your profile." });
      }
    },
    [profile]
  );

  /**
   * The page: its world, its heading, and whichever panel the session state
   * calls for. Written once here because all four states below share every
   * part of it but the panel.
   *
   * The backdrop is a SIBLING of the content column and not a child of it. Its
   * layer is fixed at z-0, so inside the column it would paint over the
   * heading rather than behind it — which is also why the column carries
   * `relative z-10`. The gallery route is arranged the same way.
   */
  function withBackdrop(children: ReactNode) {
    return (
      <>
        <AmbientBackdrop scene={backdropScene} />
        <main className="relative z-10 mx-auto w-full max-w-2xl px-4 pb-footer-clear pt-header-clear sm:px-6">
          <div className="mb-8">
            <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-brass">Account</div>
            <h1 className="font-display text-4xl font-semibold tracking-normal text-paper">Your profile</h1>
          </div>
          {children}
        </main>
        {/* Outside the column, so it is not inside that column's stacking
            context and can sit above the fixed header and footer. */}
        {toast ? (
          <Toast
            tone={toast.tone}
            message={toast.message}
            onDismiss={dismissToast}
            action={
              // Success only. A failure leaves unsaved edits on the page, and
              // a way out offered next to "could not save" is a way to lose
              // them - the one thing left to do there is press Save again.
              toast.tone === "success" ? (
                <ReturnDestinationLinks currentPath={currentPath} presentation="notice" onNavigate={dismissToast} />
              ) : undefined
            }
          />
        ) : null}
      </>
    );
  }

  if (sessionState.status === "unknown") {
    // The page and its world, with no panel yet. The session resolves on the
    // first effect, and the world starts on the create form's own default
    // exactly as the create page does — an account with a saved family sees it
    // arrive a moment later, in both places.
    return withBackdrop(null);
  }

  if (sessionState.status === "signed-out") {
    return withBackdrop(
      <div className="glass-panel w-full rounded-2xl p-6 text-center sm:p-8">
        <p className="text-lg font-semibold text-on-surface">Your profile lives with your account</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-on-surface-variant">
          Sign in to record your name, and the defaults the create-world form is filled from.
        </p>
        <Link
          href="/sign-in"
          className="focus-ring btn-gradient mt-5 inline-flex items-center gap-2 rounded-md px-4 py-2.5 font-semibold"
        >
          <UserRound className="h-4 w-4" aria-hidden="true" />
          Sign in
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return withBackdrop(
      <StatusMessage tone="loading">{status.kind === "waking" ? wakingMessage() : "Loading your profile…"}</StatusMessage>
    );
  }

  const isBusy = status.kind === "submitting" || status.kind === "waking";
  const chosenFamily = profile.preferredWorldFamily;
  const familyCopy = chosenFamily === NO_PREFERRED_FAMILY ? null : FAMILY_COPY[chosenFamily];

  return withBackdrop(
    <form onSubmit={handleSubmit} className="grid gap-6" noValidate>
      <section className="glass-panel grid gap-4 rounded-2xl p-5 sm:p-6">
        <h2 className="font-display text-xl font-semibold text-paper">You</h2>

        <label className="grid gap-1.5">
          <span className="font-mono text-xs uppercase tracking-widest text-brass">Display name</span>
          <input
            value={profile.displayName}
            onChange={(event) => updateProfile({ displayName: event.target.value })}
            disabled={isBusy}
            maxLength={MAXIMUM_DISPLAY_NAME_LENGTH}
            className="focus-ring input-dark w-full rounded-xl px-3.5 py-2 text-on-surface placeholder:text-outline"
            placeholder="e.g. Neo"
          />
          <span className="text-xs text-on-surface-variant">
            What the header calls you, and what the create-world form&rsquo;s Nickname field is filled with. There is
            one name — changing it here changes both.
          </span>
        </label>

        <label className="grid gap-1.5">
          <span className="font-mono text-xs uppercase tracking-widest text-brass">Full name</span>
          <input
            value={profile.fullName}
            onChange={(event) => updateProfile({ fullName: event.target.value })}
            disabled={isBusy}
            maxLength={MAXIMUM_FULL_NAME_LENGTH}
            className="focus-ring input-dark w-full rounded-xl px-3.5 py-2 text-on-surface placeholder:text-outline"
            placeholder="Optional"
          />
        </label>

        <label className="grid gap-1.5">
          <span className="font-mono text-xs uppercase tracking-widest text-brass">Gender</span>
          <select
            value={profile.gender}
            onChange={(event) => updateProfile({ gender: event.target.value as AccountGender })}
            disabled={isBusy}
            className="focus-ring input-dark w-full rounded-xl px-3.5 py-2 text-on-surface"
          >
            {ACCOUNT_GENDERS.map((gender) => (
              <option key={gender || "unspecified"} value={gender}>
                {ACCOUNT_GENDER_LABELS[gender]}
              </option>
            ))}
          </select>
          <span className="text-xs text-on-surface-variant">
            Nothing reads this to decide anything. It is here because it is yours to record.
          </span>
        </label>
      </section>

      <section className="glass-panel grid gap-5 rounded-2xl p-5 sm:p-6">
        <div>
          <h2 className="font-display text-xl font-semibold text-paper">Your world defaults</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            The create-world form is filled from these, and holds them to the same rules it holds itself to —{" "}
            {MINIMUM_INTERESTS} interests, {MINIMUM_TRAITS} traits, at least one colour. The written fields are
            optional. Leave one blank and the form keeps its own.
          </p>
        </div>

        {/* The toggle the owner asked for. It governs THESE fields only: the
            display name fills the Nickname field either way, because a name is
            not a preference to opt into being called by. */}
        <label className="flex items-start gap-3 rounded-xl border border-hairline bg-black/30 px-4 py-3">
          <input
            type="checkbox"
            checked={profile.autofillCreateForm}
            onChange={(event) => updateProfile({ autofillCreateForm: event.target.checked })}
            disabled={isBusy}
            className="focus-ring mt-0.5 h-4 w-4 shrink-0 accent-secondary"
          />
          <span className="grid gap-0.5">
            <span className="text-sm font-semibold text-on-surface">Fill the create-world form from my profile</span>
            <span className="text-xs text-on-surface-variant">
              On by default. Turn it off to start every world from a blank form. Your name is filled in either way.
            </span>
          </span>
        </label>

        <label className="grid gap-1.5">
          <span className="font-mono text-xs uppercase tracking-widest text-brass">Preferred world family</span>
          <select
            value={chosenFamily}
            onChange={(event) => changeFamily(event.target.value as WorldFamily | "")}
            disabled={isBusy}
            className="focus-ring input-dark w-full rounded-xl px-3.5 py-2 text-on-surface"
          >
            <option value={NO_PREFERRED_FAMILY}>No preference</option>
            {FAMILY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} — {option.description}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5">
          <span className="font-mono text-xs uppercase tracking-widest text-brass">Primary role</span>
          <input
            value={profile.creationDefaults.role ?? ""}
            onChange={(event) => updateCreationDefaults({ role: event.target.value })}
            disabled={isBusy}
            maxLength={MAXIMUM_ROLE_LENGTH}
            className="focus-ring input-dark w-full rounded-xl px-3.5 py-2 text-on-surface placeholder:text-outline"
            placeholder="e.g. Explorer"
          />
        </label>

        <ChipGroupWithCustom
          fieldLabel="Core interests"
          predefinedOptions={INTEREST_OPTIONS}
          selected={profile.creationDefaults.interests}
          onChange={(updater) => updateCreationDefaults({ interests: updater(profile.creationDefaults.interests) })}
          minimumItems={MINIMUM_INTERESTS}
          maximumItems={MAXIMUM_INTERESTS}
          minimumCharacters={MINIMUM_CUSTOM_CHIP_CHARACTERS}
          maximumCharacters={MAXIMUM_CUSTOM_CHIP_CHARACTERS}
          customPlaceholder="Add your own interest"
          customAriaLabel="Add a custom interest"
        />

        <ChipGroupWithCustom
          fieldLabel="Traits"
          predefinedOptions={TRAIT_OPTIONS}
          selected={profile.creationDefaults.traits}
          onChange={(updater) => updateCreationDefaults({ traits: updater(profile.creationDefaults.traits) })}
          minimumItems={MINIMUM_TRAITS}
          maximumItems={MAXIMUM_TRAITS}
          minimumCharacters={MINIMUM_CUSTOM_CHIP_CHARACTERS}
          maximumCharacters={MAXIMUM_CUSTOM_CHIP_CHARACTERS}
          customPlaceholder="Add your own trait"
          customAriaLabel="Add a custom trait"
          capitalizeLabels
        />

        <label className="grid gap-1.5">
          <span className="font-mono text-xs uppercase tracking-widest text-brass">Goal</span>
          <textarea
            value={profile.creationDefaults.goal}
            onChange={(event) => updateCreationDefaults({ goal: event.target.value })}
            disabled={isBusy}
            maxLength={MAXIMUM_GOAL_LENGTH}
            rows={3}
            className="focus-ring input-dark w-full rounded-xl px-3.5 py-2 text-on-surface placeholder:text-outline"
            placeholder="What you are working toward"
          />
        </label>

        <label className="grid gap-1.5">
          <span className="font-mono text-xs uppercase tracking-widest text-brass">Hidden challenge</span>
          <textarea
            value={profile.creationDefaults.challenge ?? ""}
            onChange={(event) => updateCreationDefaults({ challenge: event.target.value })}
            disabled={isBusy}
            maxLength={MAXIMUM_CHALLENGE_LENGTH}
            rows={3}
            className="focus-ring input-dark w-full rounded-xl px-3.5 py-2 text-on-surface placeholder:text-outline"
            placeholder="Optional"
          />
        </label>

        {/* Mood and style are per-family vocabularies, so they only appear once
            a family is chosen. Rendering the universe's moods under "no
            preference" would offer a value that becomes wrong the moment a
            forest is picked. */}
        {familyCopy ? (
          <>
            <SwatchChipGroup
              fieldLabel={familyCopy.moodLabel}
              options={familyCopy.moodOptions}
              selected={profile.creationDefaults.mood}
              onSelect={(mood) => updateCreationDefaults({ mood })}
            />
            <SwatchChipGroup
              fieldLabel={familyCopy.styleLabel}
              options={familyCopy.styleOptions}
              selected={profile.creationDefaults.preferredWorldStyle}
              onSelect={(preferredWorldStyle) => updateCreationDefaults({ preferredWorldStyle })}
            />
          </>
        ) : (
          <p className="text-sm text-on-surface-variant">
            Choose a world family above to set a mood and a style — each family has its own.
          </p>
        )}

        <div className="grid gap-2.5">
          <span className="font-mono text-xs uppercase tracking-widest text-brass">
            Palette (up to {MAXIMUM_FAVORITE_COLORS})
          </span>
          <div className="flex flex-wrap gap-2">
            {COLOR_OPTIONS.map((color) => {
              const isSelected = profile.creationDefaults.favoriteColors.includes(color);
              return (
                <button
                  key={color}
                  type="button"
                  disabled={isBusy}
                  aria-pressed={isSelected}
                  aria-label={`Palette colour ${color}`}
                  onClick={() =>
                    updateCreationDefaults({
                      favoriteColors: toggleItem(
                        profile.creationDefaults.favoriteColors,
                        color,
                        MINIMUM_FAVORITE_COLORS,
                        MAXIMUM_FAVORITE_COLORS
                      )
                    })
                  }
                  className={`focus-ring tappable h-9 w-9 rounded-full border-2 ${
                    isSelected ? "border-secondary" : "border-white/15"
                  }`}
                  style={{ backgroundColor: color }}
                />
              );
            })}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={isBusy}
          className="focus-ring btn-gradient inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 font-semibold disabled:opacity-60"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          Save profile
        </button>
        {/* BOTH ways out, next to the way to commit, and there whether or not
            anything was saved. A page reached from the header menu has no back
            of its own, and the toast's copy of these is gone seven seconds
            after a save.

            It used to be one link to the gallery. The create form is the other
            place somebody who has just set their defaults wants to be — it is
            the form those defaults fill — and it was reachable only by way of
            the header. */}
        <ReturnDestinationLinks currentPath={currentPath} presentation="control" />
        {status.kind === "submitting" ? <StatusMessage tone="loading">Saving…</StatusMessage> : null}
        {status.kind === "waking" ? <StatusMessage tone="loading">{wakingMessage()}</StatusMessage> : null}
        {status.kind === "failed" ? <StatusMessage tone="error">{status.message}</StatusMessage> : null}
      </div>
    </form>
  );
}
