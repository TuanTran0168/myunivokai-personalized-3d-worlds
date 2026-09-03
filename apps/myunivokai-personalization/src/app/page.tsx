"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api";
import { addWorldIdentifierToGallery } from "@/lib/savedWorlds";
import { resolveGalleryOwnerKey } from "@/lib/galleryOwner";
import { UniverseCanvas } from "@/components/UniverseCanvas";
import { GeneratingOverlay } from "@/components/GeneratingOverlay";
import { StatusMessage } from "@/components/StatusMessage";
import { ChipGroupWithCustom, type ChipGroupWithCustomHandle } from "@/components/ChipGroupWithCustom";
import { SwatchChipGroup, type SwatchOption } from "@/components/SwatchChipGroup";
import { WorldTransition, type WorldTransitionRequest } from "@/features/transitions/WorldTransition";
import { captureSceneStill } from "@/features/transitions/sceneStill";
import {
  isWorldChangeWorthPlaying,
  worldChangeDirectionBetween
} from "@/features/transitions/worldChangeDirection";
import { toggleItem } from "@/lib/formSelection";
import { activeSectionIndex, isScrolledToEnd, resolveActiveSectionId } from "@/lib/formSectionProgress";
import { FORM_RAIL_ELEMENT_ID } from "@/lib/formRailCollapse";
import { useWorldChromeCollapse, WorldChromeToggle } from "@/components/WorldChromeToggle";
import { PREVIEW_REBUILD_DEBOUNCE_MILLISECONDS, useDebouncedValue } from "@/lib/useDebouncedValue";
import { pointsOfInterestFromScene } from "@/lib/scene";
import { planetIdentityKey } from "@/features/scene-renderers/planetIdentity";
import { prefetchSceneRendererForFamily } from "@/features/scene-renderers/registry";
import { worldPagePath } from "@/lib/worldRoutes";
import type { GenerationJobStatus, PlanetSceneConfig, WorldFamily } from "@/lib/types";

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
  defaultStyleForFamily,
  type CreateFormValues
} from "@/features/world-form/worldFormOptions";
import { buildCreateWorldPayload } from "@/features/world-form/createWorldPayload";
import { buildPreviewSceneForFamily } from "@/features/world-form/previewScene";
import { createFormValuesFromProfile, isCreateFormPristine } from "@/features/world-form/profileAutofill";
import { fetchAccountProfile } from "@/lib/accountProfile";
import { MAXIMUM_DISPLAY_NAME_LENGTH } from "@/features/identity/authCredentialsFormState";
import { useProductSession } from "@/features/identity/useProductSession";

// One entry per scrollable field group in the rail, in DOM order — the single
// source of truth for both each group's `data-form-section` marker below and
// the progress indicator's segment count/order.
const PROGRESS_SECTION_IDS = [
  "world-family",
  "nickname",
  "primary-role",
  "core-interests",
  "traits",
  "goal",
  "hidden-challenge",
  "mood",
  "world-style",
  "palette"
] as const;

// The submit button is pinned in the rail footer, outside the <form> element, so
// it stays visible while the field column scrolls; this id wires it back to the
// form via the HTML `form` attribute.
const CREATE_FORM_ELEMENT_ID = "create-universe-form";

/**
 * The live-preview summary content: nickname/family title, curated-from
 * interests, and the palette. Shared by the desktop-permanent identity island
 * and the compact placard that stands in for it below `lg`, so a wording or
 * data fix applies to both at once instead of whichever one gets touched.
 */
function IdentityPlacardBody({
  nickname,
  familyNoun,
  interests,
  favoriteColors
}: {
  nickname: string;
  familyNoun: string;
  interests: string[];
  favoriteColors: string[];
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-vermillion shadow-[0_0_8px_rgba(224,87,58,0.8)]" aria-hidden="true" />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-grey">Live preview</span>
      </div>
      <div className="font-display text-lg font-semibold leading-tight text-paper">
        {nickname}&rsquo;s {familyNoun}
      </div>
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-brass">Curated from</div>
        <div className="mt-1 font-mono text-sm text-paper">{interests.slice(0, 3).join(" · ")}</div>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-brass">Palette</span>
        <div className="flex gap-1.5">
          {favoriteColors.map((color) => (
            <span
              key={color}
              className="h-3.5 w-3.5 rounded-full border border-white/20"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>
    </>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [nickname, setNickname] = useState(CREATE_FORM_INITIAL_VALUES.nickname);
  const [role, setRole] = useState(CREATE_FORM_INITIAL_VALUES.role);
  const [goal, setGoal] = useState(CREATE_FORM_INITIAL_VALUES.goal);
  const [challenge, setChallenge] = useState(CREATE_FORM_INITIAL_VALUES.challenge);
  const [interests, setInterests] = useState<string[]>(CREATE_FORM_INITIAL_VALUES.interests);
  const [traits, setTraits] = useState<string[]>(CREATE_FORM_INITIAL_VALUES.traits);
  const [mood, setMood] = useState(CREATE_FORM_INITIAL_VALUES.mood);
  const [worldFamily, setWorldFamily] = useState<WorldFamily>(CREATE_FORM_INITIAL_VALUES.worldFamily);
  const [preferredWorldStyle, setPreferredWorldStyle] = useState(CREATE_FORM_INITIAL_VALUES.preferredWorldStyle);
  const [favoriteColors, setFavoriteColors] = useState<string[]>(CREATE_FORM_INITIAL_VALUES.favoriteColors);

  /**
   * The ten fields as the one shape everything else takes: the payload, the
   * preview, and the profile-autofill rule.
   */
  const currentFormValues: CreateFormValues = useMemo(
    () => ({
      nickname,
      role,
      goal,
      challenge,
      interests,
      traits,
      mood,
      worldFamily,
      preferredWorldStyle,
      favoriteColors
    }),
    [challenge, favoriteColors, goal, interests, mood, nickname, preferredWorldStyle, role, traits, worldFamily]
  );
  /**
   * The same values, readable from a callback created several renders ago.
   *
   * The account profile arrives from the network, so the effect that applies
   * it resolves long after the render that started it — and the question it
   * asks, "has the visitor typed anything yet", has to be answered about the
   * form as it is NOW rather than as it was when the request went out. Reading
   * the closed-over state instead would let a family picked while auth-service
   * was waking up be overwritten by the profile a second later.
   */
  const currentFormValuesReference = useRef(currentFormValues);
  useEffect(() => {
    currentFormValuesReference.current = currentFormValues;
  }, [currentFormValues]);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<GenerationJobStatus | undefined>();
  const {
    collapseState: formRailCollapseState,
    toggleCollapse,
    toggleButtonReference: formRailToggleButtonReference
  } = useWorldChromeCollapse({ errorMessage: error, worldFamily });

  // Who is signed in, for the two autofills below. Read from storage rather
  // than fetched, so the name appears on the first render with no request.
  const { sessionState } = useProductSession();
  // True once a profile has been applied to this form, so a re-render or a
  // session event cannot apply it twice and clobber an edit in between.
  const hasAppliedAccountProfile = useRef(false);
  const [wasFilledFromProfile, setWasFilledFromProfile] = useState(false);

  /**
   * The name fills by DEFAULT, with no request and no toggle.
   *
   * That is the owner's rule and it is the right one: a name is not a
   * preference somebody opts into being called by. It comes from the session
   * copy already in `localStorage`, so it is there on the first render rather
   * than a moment later — and it is only applied to an untouched field, so it
   * never overwrites a nickname somebody typed for this particular world.
   */
  useEffect(() => {
    if (sessionState.status !== "signed-in") {
      return;
    }
    const accountDisplayName = sessionState.account.name?.trim();
    if (!accountDisplayName) {
      return;
    }
    setNickname((currentNickname) =>
      currentNickname === CREATE_FORM_INITIAL_VALUES.nickname ? accountDisplayName : currentNickname
    );
  }, [sessionState]);

  /**
   * Everything else fills only when the account's own toggle says so.
   *
   * The guard is isCreateFormPristine rather than a "has the visitor typed"
   * flag threaded through a dozen change handlers: the question is exactly
   * "does this form still hold what it opened with", and comparing against
   * CREATE_FORM_INITIAL_VALUES answers it in one place that a test can reach.
   *
   * A failure is swallowed. The profile is a convenience on this screen, and a
   * cold auth-service must not put an error banner on the page somebody came
   * here to create a world on.
   */
  useEffect(() => {
    if (sessionState.status !== "signed-in" || hasAppliedAccountProfile.current) {
      return;
    }
    hasAppliedAccountProfile.current = true;
    let isMounted = true;
    fetchAccountProfile()
      .then((accountProfile) => {
        if (!isMounted || !accountProfile.autofillCreateForm) {
          return;
        }
        const currentValues = currentFormValuesReference.current;
        if (!isCreateFormPristine(currentValues)) {
          return;
        }
        const filledValues = createFormValuesFromProfile(accountProfile, currentValues);
        setNickname(filledValues.nickname);
        setRole(filledValues.role);
        setGoal(filledValues.goal);
        setChallenge(filledValues.challenge);
        setInterests(filledValues.interests);
        setTraits(filledValues.traits);
        setMood(filledValues.mood);
        // Through showWorldFamilyOnCanvas, never setWorldFamily on its own:
        // the canvas follows a SECOND piece of state, and a family set without
        // it leaves the form saying ocean while the world stays a universe.
        // That was the bug — a preferred family that filled the picker and
        // changed nothing anybody could see.
        showWorldFamilyOnCanvas(currentValues.worldFamily, filledValues.worldFamily);
        setPreferredWorldStyle(filledValues.preferredWorldStyle);
        setFavoriteColors(filledValues.favoriteColors);
        setWasFilledFromProfile(true);
      })
      .catch(() => {
        // Deliberately silent - see this effect's own comment.
      });
    return () => {
      isMounted = false;
    };
    // Depends on the session only, and now honestly so: the field values are
    // read from currentFormValuesReference at the moment the profile answers,
    // rather than closed over from the render that started the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionState.status]);

  /**
   * Empties the form for this world only, leaving the saved profile alone.
   *
   * Not a second copy of the profile page's toggle: that one is the account's
   * standing preference, this is "not this time". Two controls for one setting
   * would be worse than one control and one escape hatch.
   */
  function startFromBlankForm() {
    setNickname(CREATE_FORM_INITIAL_VALUES.nickname);
    setRole(CREATE_FORM_INITIAL_VALUES.role);
    setGoal(CREATE_FORM_INITIAL_VALUES.goal);
    setChallenge(CREATE_FORM_INITIAL_VALUES.challenge);
    setInterests(CREATE_FORM_INITIAL_VALUES.interests);
    setTraits(CREATE_FORM_INITIAL_VALUES.traits);
    setMood(CREATE_FORM_INITIAL_VALUES.mood);
    // Same rule as the autofill above: emptying the form has to carry the
    // canvas back to the family the form opens with, or the world keeps
    // showing the profile's ocean under a blank universe form.
    showWorldFamilyOnCanvas(worldFamily, CREATE_FORM_INITIAL_VALUES.worldFamily);
    setPreferredWorldStyle(CREATE_FORM_INITIAL_VALUES.preferredWorldStyle);
    setFavoriteColors(CREATE_FORM_INITIAL_VALUES.favoriteColors);
    setWasFilledFromProfile(false);
  }

  // Each chip group manages its own custom-value draft internally; these refs
  // exist only so the rail can force an in-progress draft to commit before it
  // goes invisible (see handleFormRailToggle) — the same concern the old
  // single closeCustomInterestInput handled for Interests alone.
  const interestsChipGroupReference = useRef<ChipGroupWithCustomHandle>(null);
  const traitsChipGroupReference = useRef<ChipGroupWithCustomHandle>(null);

  const railScrollReference = useRef<HTMLDivElement | null>(null);
  const [activeFormSectionId, setActiveFormSectionId] = useState<string | null>(null);

  // The live world, and the transition that carries one family off when another
  // is picked. The container ref is what the still captures work against — the
  // same shape the world route's genie reveal already uses.
  const sceneContainerReference = useRef<HTMLDivElement | null>(null);
  const [transitionRequest, setTransitionRequest] = useState<WorldTransitionRequest | null>(null);
  const transitionTokenReference = useRef(0);
  // Whether the CURRENT preview scene has rendered a real frame — reset to
  // false in the same update that starts a transition, so the hold always gets
  // at least one tick to wait on. See worldChangeStages.ts for why the arrival
  // waits on this instead of playing the instant a family is picked.
  const [isSceneReady, setIsSceneReady] = useState(false);
  /**
   * Which family the CANVAS is showing, as opposed to which one the form says.
   *
   * The two are the same except during a transition, when this one lags by
   * exactly the length of the departure. That lag is not cosmetic — it is what
   * keeps the whole thing at 60 fps. Mounting a family for the first time
   * blocks the main thread for up to ~2.5 seconds compiling shaders, and the
   * departure is a canvas animation that would be queued behind every
   * millisecond of it. Holding the mount back until the outgoing world has
   * finished leaving puts that block inside the one phase whose animation runs
   * on the compositor and does not care. `worldChangeStages.ts` has the full
   * account; `WorldTransition`'s `onDeparted` is what releases it.
   *
   * Everything else about the form — the mood swatches, the submit label, the
   * chrome tint — still follows `worldFamily` immediately, so the picker itself
   * never feels like it lagged.
   */
  const [renderedWorldFamily, setRenderedWorldFamily] = useState<WorldFamily>(CREATE_FORM_INITIAL_VALUES.worldFamily);

  /**
   * Move the form to a family AND move the canvas with it, carrying the old
   * world off on the way.
   *
   * THE ONLY PLACE `setWorldFamily` IS CALLED. That is the invariant this
   * function exists to hold: `worldFamily` is what the form says and
   * `renderedWorldFamily` is what the canvas shows, they are allowed to differ
   * only for the length of a departure, and every path that changes the first
   * has to be a path that eventually changes the second. Two paths were not —
   * the profile autofill and the "start from a blank form" button — which is
   * how an account whose preferred family was ocean got a filled-in picker
   * over an unchanged universe.
   *
   * `fromFamily` is passed rather than read from state because one caller is a
   * network callback whose closure may be several renders old.
   *
   * The still is captured HERE, before the state update, and that ordering is
   * the whole trick: one render later React may have swapped the canvas for the
   * next family's and the frame worth keeping no longer exists. A capture that
   * comes back null (no canvas yet, a cleared GL buffer, a zero-size box)
   * simply means no transition — the family still changes, immediately.
   */
  function showWorldFamilyOnCanvas(fromFamily: WorldFamily, nextFamily: WorldFamily) {
    if (!isWorldChangeWorthPlaying(fromFamily, nextFamily)) {
      return;
    }
    const still = captureSceneStill(sceneContainerReference.current);
    if (still) {
      transitionTokenReference.current += 1;
      setIsSceneReady(false);
      setTransitionRequest({
        still,
        direction: worldChangeDirectionBetween(
          FAMILY_OPTIONS.findIndex((option) => option.value === fromFamily),
          FAMILY_OPTIONS.findIndex((option) => option.value === nextFamily)
        ),
        family: nextFamily,
        token: transitionTokenReference.current
      });
    } else {
      // No picture to carry off, so nothing to wait for: the canvas swaps now.
      setRenderedWorldFamily(nextFamily);
    }
    setWorldFamily(nextFamily);
  }

  /** The picker's own handler: the family change, plus the style that goes with it. */
  function handleSelectWorldFamily(nextFamily: WorldFamily) {
    if (!isWorldChangeWorthPlaying(worldFamily, nextFamily)) {
      return;
    }
    showWorldFamilyOnCanvas(worldFamily, nextFamily);
    // A style belongs to exactly one family now, and the gateway returns 400
    // for one family's style posted to another. Reset to the family's own
    // neutral style rather than carrying the old value across — the neutral is
    // a no-op in its builder, so this is the least surprising landing point as
    // well as the only valid one.
    //
    // The autofill does NOT come through here: it has a saved style of its own
    // to apply, and this line would throw it away.
    setPreferredWorldStyle(defaultStyleForFamily(nextFamily));
  }

  // Drives the rail's section-progress indicator. Kept as a running map of
  // every section's own latest ratio rather than acting on each callback's
  // `entries` alone: IntersectionObserver only reports elements that crossed a
  // threshold since the last check, so trusting entries in isolation would let
  // a section that just barely entered view outrank one still mostly visible
  // but simply absent from that particular batch.
  //
  // `root` is the rail's own scrollport, and the margins are read against IT.
  //
  // This used to be the default viewport root, correct back when `.rail-scroll`
  // only clipped from `lg:overflow-y-auto` up and the page itself scrolled below
  // that. It stopped being correct the moment the rail became an absolutely
  // positioned sheet that scrolls internally at every tier, and it failed in
  // exactly one place: on phones the sheet starts at `top-[46svh]`, while a
  // viewport root with these margins puts the active band between 20% and 40%
  // of the viewport — entirely in the world above the sheet. No section could
  // ever land in it, every ratio stayed 0, `pickActiveSectionId` kept returning
  // the null it started with, and the indicator sat frozen on its first segment
  // no matter how far the visitor scrolled. Desktop hid it: from `md` the rail
  // spans `top-16` to `bottom-16`, so the viewport band happened to fall inside
  // the field column anyway.
  //
  // Against the scrollport the same two margins mean what they were written to
  // mean at every width — a band a fifth of the way down the visible fields —
  // and there is no tier where the root and the thing being scrolled are
  // different elements.
  useEffect(() => {
    const railScrollElement = railScrollReference.current;
    if (!railScrollElement) {
      return;
    }
    // Rebound after the guard: TypeScript drops the narrowing on the ref read
    // inside the function DECLARATION below, which hoists.
    const scrollContainer = railScrollElement;
    const sectionElements = Array.from(scrollContainer.querySelectorAll<HTMLElement>("[data-form-section]"));
    if (sectionElements.length === 0) {
      return;
    }
    const latestRatioBySectionId = new Map<string, number>();
    function publishActiveSection() {
      const visibilities = Array.from(latestRatioBySectionId, ([id, intersectionRatio]) => ({
        id,
        intersectionRatio
      }));
      const hasReachedEnd = isScrolledToEnd(scrollContainer);
      setActiveFormSectionId((current) =>
        resolveActiveSectionId(PROGRESS_SECTION_IDS, visibilities, current, hasReachedEnd)
      );
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const sectionId = entry.target.getAttribute("data-form-section");
          if (sectionId) {
            latestRatioBySectionId.set(sectionId, entry.intersectionRatio);
          }
        }
        publishActiveSection();
      },
      { root: scrollContainer, rootMargin: "-20% 0px -60% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    for (const element of sectionElements) {
      observer.observe(element);
    }
    // The observer alone cannot see the bottom of the scroll: the last section
    // is already past the band by the time the column stops moving, so no
    // threshold is crossed and no callback fires. The scroll event is what
    // reports that final state.
    scrollContainer.addEventListener("scroll", publishActiveSection, { passive: true });
    return () => {
      observer.disconnect();
      scrollContainer.removeEventListener("scroll", publishActiveSection);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api
      .resumePendingWorld({
        signal: controller.signal,
        onProgress: (job) => {
          setLoading(true);
          setGenerationStatus(job.status);
        }
      })
      .then((result) => {
        if (!result) {
          // Nothing pending to resume — make sure the overlay is not shown.
          if (!controller.signal.aborted) {
            setLoading(false);
          }
          return;
        }
        // The shelf is resolved rather than assumed: a world made while
        // signed in belongs to the account, and one made signed out belongs to
        // the anonymous shelf.
        //
        // Not awaited here, unlike onSubmit's save: this callback is not async
        // and the navigation below must not wait on it. The write lands either
        // way — a client-side navigation does not tear down this module — and
        // the gallery is not the screen being navigated to.
        void resolveGalleryOwnerKey().then((ownerKey) =>
          addWorldIdentifierToGallery(result.world.id, result.family, ownerKey)
        );
        // Success: keep the overlay up through navigation (same reason as
        // onSubmit); do NOT clear loading here.
        router.push(worldPagePath(result.world.id, result.family));
      })
      .catch((resumeError) => {
        if (!controller.signal.aborted) {
          setError(apiErrorMessage(resumeError));
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [router]);

  const payload = useMemo(() => buildCreateWorldPayload(currentFormValues), [currentFormValues]);

  // Captured once, from the very first render, so it is exactly the payload
  // every field's own initial state produces — the "nobody has typed anything
  // yet" snapshot, independent of what those defaults happen to be.
  const initialPayloadReference = useRef(payload);

  // Built from the same sanitized payload that is submitted (not the raw form
  // state) so the preview's planet count and names match the generated world,
  // and debounced so typing does not rebuild the canvas on every keystroke.
  const debouncedPayload = useDebouncedValue(payload, PREVIEW_REBUILD_DEBOUNCE_MILLISECONDS);
  // True only until the visitor changes ANY field from its starting value.
  // Ocean's live preview uses this to show its calm sunlit-surface default
  // instead of whatever the fixed placeholder seed happens to roll — see
  // buildPreviewDepthConfig's comment. Universe and forest need no such
  // override: every state their own fixed seed can land on already reads as
  // "a nice solar system" / "a nice forest," which is exactly the property
  // ocean's underwater states don't all share.
  const isPreviewUncustomized = useMemo(
    () => JSON.stringify(debouncedPayload) === JSON.stringify(initialPayloadReference.current),
    [debouncedPayload]
  );
  // Same inputs, family-specific mirror: the preview always renders with the
  // exact renderer the generated world will use.
  //
  // Keyed on renderedWorldFamily, NOT worldFamily. During a transition the
  // two differ, and this is the seam where that matters: recomputing the
  // scene the moment the picker is clicked would mount the destination
  // straight into the departure animation, which is precisely what the
  // deferred commit exists to prevent.
  const previewScene = useMemo(
    () =>
      buildPreviewSceneForFamily(renderedWorldFamily, debouncedPayload, {
        showCalmSurfaceDefault: isPreviewUncustomized
      }),
    [debouncedPayload, isPreviewUncustomized, renderedWorldFamily]
  );

  // The preview mounts the selected family immediately, so that chunk is already
  // in flight. Warm the others as well: this is the one page whose whole job is
  // choosing between families, and people flick the picker back and forth. A
  // spinner on every flick is a worse trade than bytes that arrive after first
  // paint. The world and share routes, which know their family for certain,
  // still fetch exactly one renderer.
  useEffect(() => {
    for (const option of FAMILY_OPTIONS) {
      prefetchSceneRendererForFamily(option.value);
    }
  }, []);

  // The preview is fully interactive too: clicking a planet/landmark/animal
  // flies the camera to it, exactly like the world page.
  const [selectedPreviewPointKey, setSelectedPreviewPointKey] = useState<string | null>(null);
  const previewPointsOfInterest = useMemo(() => pointsOfInterestFromScene(previewScene), [previewScene]);
  useEffect(() => {
    setSelectedPreviewPointKey(null);
  }, [previewScene]);

  function handleSelectPreviewPoint(pointOfInterest: PlanetSceneConfig | null) {
    if (!pointOfInterest) {
      setSelectedPreviewPointKey(null);
      return;
    }
    const pointIndex = previewPointsOfInterest.indexOf(pointOfInterest);
    setSelectedPreviewPointKey(planetIdentityKey(pointOfInterest, pointIndex));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    setGenerationStatus("queued");
    try {
      const world = await api.createWorld(payload, worldFamily, {
        onProgress: (job) => setGenerationStatus(job.status)
      });
      addWorldIdentifierToGallery(world.id, worldFamily, await resolveGalleryOwnerKey());
      // Keep the overlay up THROUGH the navigation. router.push is async: it
      // returns before the world route mounts and its scene renders. Clearing
      // loading here (the old `finally`) hid the overlay while this create page
      // — the live preview — was still on screen, so it looked "done" before
      // the world appeared. The loading state is discarded when this page
      // unmounts on navigation; it is only reset if navigation never happens
      // (the catch below).
      router.push(worldPagePath(world.id, worldFamily));
    } catch (err) {
      setError(apiErrorMessage(err));
      setLoading(false);
    }
  }

  function toggleColor(color: string) {
    setFavoriteColors((current) => toggleItem(current, color, MINIMUM_FAVORITE_COLORS, MAXIMUM_FAVORITE_COLORS));
  }

  // Every section renders for every family now that World Style does, so the
  // indicator has one fixed set of segments again. It used to drop the
  // world-style segment for the two families whose picker was hidden.
  const visibleFormSectionIds = PROGRESS_SECTION_IDS;
  const activeFormSectionPosition = activeSectionIndex(visibleFormSectionIds, activeFormSectionId);

  function handleFormRailToggle() {
    // Commit any half-typed custom chip value through the same path each
    // input's own onBlur uses, rather than relying on the browser to blur it
    // for us: the rail is about to become invisible and the draft would be
    // unreachable. This is the create page's own concern, which is why the
    // shared hook does not know about it.
    interestsChipGroupReference.current?.commitPendingCustomValue();
    traitsChipGroupReference.current?.commitPendingCustomValue();
    toggleCollapse();
  }

  // One viewport, never a scrolling document, at EVERY tier.
  //
  // Below `md` this page used to be a flex column: a tall hero with the rail in
  // flow underneath it, so reaching the palette meant scrolling the world off
  // the top of the screen. On the one page whose whole subject is a live
  // portrait of you, scrolling away from the portrait in order to fill in the
  // form that makes it is the wrong trade. Now the world is pinned behind
  // everything and the rail is a sheet over the lower part of it with its own
  // scrollport — which is the shape the tablet and desktop tiers already had,
  // taken all the way down.
  return (
    <main className={`relative h-svh overflow-hidden ${FAMILY_COPY[worldFamily].chromeClassName}`}>
      <GeneratingOverlay
        isVisible={loading}
        status={generationStatus === "queued" || generationStatus === "processing" ? generationStatus : undefined}
      />

      {/* The one control that hides the whole interface and brings it back. It
          sits OUTSIDE the collapsing region on purpose: it can never hide
          itself, and focus is never inside the region at the moment that region
          disappears. Disabled while generating, so a collapse can never start
          behind the overlay. */}
      <WorldChromeToggle
        isExpanded={formRailCollapseState.isExpanded}
        onToggle={handleFormRailToggle}
        controlsElementId={FORM_RAIL_ELEMENT_ID}
        noun="form"
        buttonReference={formRailToggleButtonReference}
        disabled={loading}
      />

      {/* Full-bleed live world, behind everything, at every tier. It no longer
          changes height when the rail collapses: the rail floats over it now
          rather than sitting under it, so there is no box to give back. */}
      <div ref={sceneContainerReference} className="absolute inset-0 h-full w-full">
        <UniverseCanvas
          scene={previewScene}
          className="h-full"
          selectedPlanetKey={selectedPreviewPointKey}
          onSelectPlanet={handleSelectPreviewPoint}
          enableAmbientSound
          // Read back by captureSceneStill when a family is switched. The world
          // route already opts in for Export Image; here it is what makes the
          // outgoing frame readable at all — without it the swipe would carry a
          // transparent rectangle across the screen.
          preserveDrawingBuffer
          // A settle, not a premiere: this preview re-solves its framing on
          // every option toggle, and the full opening move would replay in
          // full each time.
          entryMotion="settle"
          onSceneReady={() => setIsSceneReady(true)}
        />

        {/* Floating identity island (desktop): live state, the curatorial
            accession, and the palette — opposite the form rail. Wrapped for the
            same reason the rail is: the panel's own .glass-rise retains a
            transform and .glass-panel is reset to `transform: none` under
            reduced motion, so the exit has to live on a plain ancestor.

            Always mounted from `lg` up (regardless of collapse state); it
            clears with the rest of the interface via .immersive-exit the
            moment the rail collapses, same as the header and footer. Below
            `lg` it never renders at all — there is no room to float it beside a
            rail that already spans the width, and nothing stands in for it once
            the rail is hidden, on purpose. */}
        <div className="immersive-exit immersive-exit-right pointer-events-none absolute right-5 top-[72px] hidden w-[290px] lg:block">
          <div className="glass-panel glass-panel-glow glass-rise flex w-full flex-col gap-3 rounded-2xl px-4 py-3.5">
            <IdentityPlacardBody
              nickname={payload.nickname}
              familyNoun={FAMILY_COPY[worldFamily].noun}
              interests={payload.interests}
              favoriteColors={payload.favoriteColors}
            />
          </div>
        </div>

        {/* There is deliberately no compact placard below `lg` any more.
            A phone used to get one the moment the rail collapsed — the same
            live-preview summary, standing in for the desktop island there is no
            room to float. It was the wrong reading of the control: hiding the
            form is a request to see the WORLD, and answering it by swapping one
            panel for another gives back a third of a small screen and none of
            the point. Hide now means hide, at every width. */}
      </div>
      <WorldTransition
        request={transitionRequest}
        sceneContainerReference={sceneContainerReference}
        isDestinationReady={isSceneReady}
        // Reads the family the form already moved to rather than closing over
        // the one the request was made with: if a second pick landed while the
        // first was still leaving, the canvas has to end up on the LAST one.
        onDeparted={() => setRenderedWorldFamily(worldFamily)}
        onFinished={() => setTransitionRequest(null)}
      />

      {/* Floating Liquid-Glass form rail: a bottom sheet over the world on
          phones, a floating glass island from the tablet tier up, narrower at
          `md` and at its full width from `lg`. Only the field column ever
          scrolls, at every tier.

          `top-[46svh]` on phones is the one number that decides the split: the
          world keeps the upper 46% of the screen and never leaves it, and the
          sheet gets the rest. Measured in `svh` rather than `vh` so a phone
          browser retracting its URL bar cannot push the submit button under the
          footer.

          The positioning lives on this WRAPPER rather than on the panel, and the
          wrapper deliberately carries neither .glass-panel nor .glass-rise: the
          entrance animation's retained transform and the reduced-motion
          `transform: none` on .glass-panel would each silently defeat a collapse
          applied to the panel itself. See .form-rail-collapse in globals.css.

          It no longer has a "reserves layout space" branch either. That existed
          because the rail was in the mobile document flow and a transform does
          not affect layout, so the box had to be released a beat after the slide
          — an absolutely positioned rail has no box to release. */}
      <div
        id={FORM_RAIL_ELEMENT_ID}
        data-form-rail-collapsed={!formRailCollapseState.isExpanded}
        className="form-rail-collapse form-rail-sheet absolute inset-x-3 bottom-[calc(var(--footer-height)+0.5rem)] top-[46svh] z-10 sm:inset-x-4 md:inset-x-auto md:bottom-16 md:left-6 md:top-16 md:w-[340px] lg:bottom-[68px] lg:top-[72px] lg:w-[384px]"
      >
      <section className="glass-panel glass-panel-glow glass-rise flex h-full w-full flex-col overflow-hidden rounded-3xl">
          {/* The rail's own masthead. It used to stack an eyebrow, a text-3xl
              title, a two-line subtitle and the progress bar, which came to
              169px — a third of the rail's 760px on a 900px-tall laptop went to
              chrome before a single field. The title now shares its row with
              the eyebrow, and the subtitle is dropped from `lg` up, where the
              identity island opposite already says whose world this is and what
              it was curated from. Below `lg` there is no island, so it stays. */}
          <div className="border-b border-white/5 px-5 pb-2.5 pt-3 sm:px-7">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-xs uppercase tracking-[0.2em] text-brass">Curate</span>
              <h1 className="font-display text-xl font-semibold leading-tight text-paper">A portrait of you.</h1>
            </div>
            <p className="mt-1.5 text-sm text-grey lg:hidden">
              Your details are mounted as a world that is exactly, only, yours.
            </p>
            {/* Lightweight sense-of-progress for the rail's internal scroll —
                one segment per field group, lit up through the one the visitor is
                currently at. Purely a read of scroll position; it does not gate
                navigation, so a visitor can still jump ahead by scrolling past it. */}
            <div
              className="mt-3 flex gap-1"
              role="progressbar"
              aria-label="Form section progress"
              aria-valuemin={1}
              aria-valuemax={visibleFormSectionIds.length}
              aria-valuenow={activeFormSectionPosition + 1}
            >
              {visibleFormSectionIds.map((sectionId, index) => (
                <span
                  key={sectionId}
                  aria-hidden="true"
                  className={`h-[3px] flex-1 rounded-full transition-colors ${
                    index <= activeFormSectionPosition ? "bg-brass" : "bg-white/10"
                  }`}
                />
              ))}
            </div>
          </div>

          <div ref={railScrollReference} className="rail-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            {/* gap-3.5 / py-4, tightened from gap-4 / py-5. The rail is a column
                of ten short groups, and at 16px between them plus 20px of top
                and bottom padding the gaps alone came to 164px — a fifth of the
                scrollport spent on nothing. 14px still separates the groups
                clearly and gives back about a field and a half. */}
            <form id={CREATE_FORM_ELEMENT_ID} className="grid gap-3.5 px-5 py-4 sm:px-7" onSubmit={onSubmit}>
              {/* Said out loud rather than left to be noticed. A form that
                  silently arrives full is a form somebody has to reverse-
                  engineer; one sentence turns that into a fact, and the escape
                  hatch beside it means the answer to "not this time" is not
                  "go and change your profile". */}
              {wasFilledFromProfile ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hairline bg-black/30 px-3.5 py-2.5 text-xs text-on-surface-variant">
                  <span>Filled in from your profile.</span>
                  <button
                    type="button"
                    onClick={startFromBlankForm}
                    className="focus-ring rounded text-secondary underline-offset-4 hover:underline"
                  >
                    Start from a blank form
                  </button>
                </div>
              ) : null}

              <div className="grid gap-2.5" data-form-section={PROGRESS_SECTION_IDS[0]}>
                <span className="font-mono text-xs uppercase tracking-widest text-brass">World Family</span>
                {/* grid-cols-3, not -2: with exactly 3 options a 2-column grid always
                    orphans the third card alone on its own row. */}
                <div className="grid grid-cols-3 gap-2">
                  {FAMILY_OPTIONS.map((option) => {
                    const selected = worldFamily === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => handleSelectWorldFamily(option.value)}
                        aria-pressed={selected}
                        className={`focus-ring glass-panel tappable relative rounded-xl border-2 px-2 py-2.5 text-center ${
                          selected
                            ? "scale-[1.03] border-brass bg-brass/10 ring-2 ring-brass/40"
                            : "border-transparent hover:border-white/20"
                        }`}
                      >
                        {selected ? (
                          <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-brass text-ink">
                            <Check className="h-2.5 w-2.5" aria-hidden="true" />
                          </span>
                        ) : null}
                        <option.Icon
                          className={`mx-auto mb-1.5 h-6 w-6 ${selected ? "text-brass" : "text-on-surface-variant"}`}
                          aria-hidden="true"
                        />
                        <span className={`block text-sm ${selected ? "font-semibold text-brass" : "text-on-surface"}`}>
                          {option.label}
                        </span>
                        <span className="mt-0.5 block text-[10px] leading-tight text-on-surface-variant">
                          {option.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Nickname and Primary Role side by side. Two single-line inputs
                  stacked cost 148px of a 508px scrollport to hold about twenty
                  characters between them. They stay stacked below `sm`, where
                  half a phone's width is not enough for either placeholder.

                  `min-w-0` on both columns is not defensive — without it these
                  two overlapped, measurably: 98px of overlap in a 340px rail and
                  76px in a 384px one. A grid item's `min-width` defaults to
                  `auto`, which means "never shrink below the content's own
                  intrinsic width", and an <input>'s intrinsic width is its
                  `size` attribute — about 245px whatever the placeholder says.
                  Two 245px columns cannot fit in a 300px track, so they ran over
                  each other instead of sharing it. This is also why the form
                  looked correct at 75% browser zoom and broken at 100%: at 75%
                  the track was finally wide enough to hold both intrinsic
                  widths, so the bug simply stopped being reachable. */}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid min-w-0 gap-1.5" data-form-section={PROGRESS_SECTION_IDS[1]}>
                  <span className="font-mono text-xs uppercase tracking-widest text-brass">Nickname</span>
                  <input
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                    className="focus-ring input-dark w-full min-w-0 rounded-xl px-3.5 py-2 text-on-surface placeholder:text-outline"
                    placeholder="e.g. Neo"
                    maxLength={MAXIMUM_DISPLAY_NAME_LENGTH}
                  />
                </label>
                <label className="grid min-w-0 gap-1.5" data-form-section={PROGRESS_SECTION_IDS[2]}>
                  <span className="font-mono text-xs uppercase tracking-widest text-brass">Primary Role</span>
                  <input
                    value={role}
                    onChange={(event) => setRole(event.target.value)}
                    className="focus-ring input-dark w-full min-w-0 rounded-xl px-3.5 py-2 text-on-surface placeholder:text-outline"
                    placeholder="e.g. Explorer"
                    maxLength={MAXIMUM_ROLE_LENGTH}
                  />
                </label>
              </div>

              <div data-form-section={PROGRESS_SECTION_IDS[3]}>
                <ChipGroupWithCustom
                  ref={interestsChipGroupReference}
                  fieldLabel="Core Interests"
                  predefinedOptions={INTEREST_OPTIONS}
                  selected={interests}
                  onChange={setInterests}
                  minimumItems={MINIMUM_INTERESTS}
                  maximumItems={MAXIMUM_INTERESTS}
                  minimumCharacters={MINIMUM_CUSTOM_CHIP_CHARACTERS}
                  maximumCharacters={MAXIMUM_CUSTOM_CHIP_CHARACTERS}
                  customPlaceholder="Your own interest"
                  customAriaLabel="Add a custom interest (2-32 characters)"
                />
              </div>

              <div data-form-section={PROGRESS_SECTION_IDS[4]}>
                <ChipGroupWithCustom
                  ref={traitsChipGroupReference}
                  fieldLabel="Traits"
                  predefinedOptions={TRAIT_OPTIONS}
                  selected={traits}
                  onChange={setTraits}
                  minimumItems={MINIMUM_TRAITS}
                  maximumItems={MAXIMUM_TRAITS}
                  minimumCharacters={MINIMUM_CUSTOM_CHIP_CHARACTERS}
                  maximumCharacters={MAXIMUM_CUSTOM_CHIP_CHARACTERS}
                  customPlaceholder="Your own trait"
                  customAriaLabel="Add a custom trait (2-32 characters)"
                  capitalizeLabels
                  accent="secondary"
                />
              </div>

              <label className="grid gap-1.5" data-form-section={PROGRESS_SECTION_IDS[5]}>
                <span className="font-mono text-xs uppercase tracking-widest text-brass">Goal</span>
                {/* Still resizable, so anyone writing a long one can open it up. */}
                <textarea
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  className="focus-ring input-dark min-h-[60px] resize-y rounded-xl px-3.5 py-2 text-on-surface placeholder:text-outline"
                  placeholder="Build a beautiful AI product that feels personal and useful."
                  maxLength={MAXIMUM_GOAL_LENGTH}
                />
              </label>

              <label className="grid gap-1.5" data-form-section={PROGRESS_SECTION_IDS[6]}>
                <span className="font-mono text-xs uppercase tracking-widest text-brass">Hidden Challenge</span>
                <input
                  value={challenge}
                  onChange={(event) => setChallenge(event.target.value)}
                  className="focus-ring input-dark w-full min-w-0 rounded-xl px-3.5 py-2 text-on-surface placeholder:text-outline"
                  placeholder="e.g. I overthink product direction"
                  maxLength={MAXIMUM_CHALLENGE_LENGTH}
                />
              </label>

              <div data-form-section={PROGRESS_SECTION_IDS[7]}>
                <SwatchChipGroup
                  fieldLabel={FAMILY_COPY[worldFamily].moodLabel}
                  options={FAMILY_COPY[worldFamily].moodOptions}
                  selected={mood}
                  onSelect={setMood}
                  accent="secondary"
                />
              </div>

              {/* Every family, each with its own vocabulary and its own label,
                  because each one styles a different thing: the universe its
                  sky and orbits, the forest how it is grown and lit, the ocean
                  its water and what lives in it.

                  This was hidden for the forest and the ocean, and correctly
                  so at the time — both services stored the field and never read
                  it, so the control changed nothing. Both read it now. */}
              <div data-form-section={PROGRESS_SECTION_IDS[8]}>
                <SwatchChipGroup
                  fieldLabel={FAMILY_COPY[worldFamily].styleLabel}
                  options={FAMILY_COPY[worldFamily].styleOptions}
                  selected={preferredWorldStyle}
                  onSelect={setPreferredWorldStyle}
                  accent="primary"
                />
              </div>

              <div className="grid gap-2" data-form-section={PROGRESS_SECTION_IDS[9]}>
                <span className="font-mono text-xs uppercase tracking-widest text-brass">Palette</span>
                <div className="flex flex-wrap gap-2">
                  {COLOR_OPTIONS.map((color) => {
                    const selected = favoriteColors.includes(color);
                    return (
                      <button
                        key={color}
                        type="button"
                        title={color}
                        aria-label={color}
                        aria-pressed={selected}
                        onClick={() => toggleColor(color)}
                        className={`focus-ring tappable h-10 w-10 rounded-xl border ${selected ? "scale-[1.06] border-primary ring-2 ring-primary/30" : "border-white/15 hover:border-white/30"}`}
                        style={{ backgroundColor: color }}
                      />
                    );
                  })}
                </div>
              </div>
            </form>
          </div>

          <div className="grid gap-3 border-t border-white/10 px-5 py-3 sm:px-7">
            {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
            <button
              type="submit"
              form={CREATE_FORM_ELEMENT_ID}
              disabled={loading}
              className="focus-ring btn-brass inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-8 py-3 text-sm font-semibold uppercase tracking-[0.04em] transition disabled:cursor-wait disabled:opacity-70"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {FAMILY_COPY[worldFamily].submitLabel}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
      </section>
      </div>
    </main>
  );
}
