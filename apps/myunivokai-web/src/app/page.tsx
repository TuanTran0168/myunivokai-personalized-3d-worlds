"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Loader2, Orbit, Plus, Trees, Waves } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api";
import { addWorldIdentifierToGallery } from "@/lib/savedWorlds";
import { UniverseCanvas } from "@/components/UniverseCanvas";
import { GeneratingOverlay } from "@/components/GeneratingOverlay";
import { StatusMessage } from "@/components/StatusMessage";
import { ensureRange, toggleItem } from "@/lib/formSelection";
import { FORM_RAIL_ELEMENT_ID } from "@/lib/formRailCollapse";
import { useWorldChromeCollapse, WorldChromeToggle } from "@/components/WorldChromeToggle";
import { buildPreviewSceneConfig, pointsOfInterestFromScene } from "@/lib/scene";
import { buildPreviewForestSceneConfig } from "@/lib/forestScene";
import { buildPreviewOceanSceneConfig } from "@/lib/oceanScene";
import { planetIdentityKey } from "@/features/scene-renderers/planetIdentity";
import { prefetchSceneRendererForFamily } from "@/features/scene-renderers/registry";
import { worldPagePath } from "@/lib/worldRoutes";
import type { GenerationJobStatus, PlanetSceneConfig, WorldFamily } from "@/lib/types";

// The world-family picker: which backend curates the portrait. Universe =
// universe-service (solar system), Forest = nature-service (living forest),
// Ocean = ocean-service (a sea at one depth). Same inputs, same mechanism —
// only the scene family differs.
const familyOptions: { label: string; value: WorldFamily; description: string; Icon: typeof Orbit }[] = [
  { label: "Universe", value: "universe", description: "A solar system of you", Icon: Orbit },
  { label: "Forest", value: "nature", description: "A living forest of you", Icon: Trees },
  { label: "Ocean", value: "ocean", description: "A sea of you, at depth", Icon: Waves }
];

const interestOptions = ["Technology", "Art", "Science", "Design", "Music", "AI", "Storytelling", "Product"];
const traitOptions = ["curious", "builder", "focused", "creative", "calm", "explorer"];
// Same four mood VALUES for every family (the backend contract keys off
// them); only the label/swatch changes so the card reads in the family's own
// language — universe moods are cosmic, forest moods are seasonal (each label
// names the season that mood leans toward in the forest builder).
const moodOptions = [
  { label: "Cybernetic", value: "focused", swatch: "#3b82f6" },
  { label: "Nebula", value: "dreamy", swatch: "#a855f7" },
  { label: "Solar", value: "energetic", swatch: "#eab308" },
  { label: "Void", value: "reflective", swatch: "#ef4444" }
];
const natureMoodOptions = [
  { label: "Frostwood", value: "focused", swatch: "#93C5FD" },
  { label: "Blossom", value: "dreamy", swatch: "#F9A8D4" },
  { label: "Summer Meadow", value: "energetic", swatch: "#4ADE80" },
  { label: "Amber Autumn", value: "reflective", swatch: "#F59E0B" }
];
// Each ocean label names the depth that mood IS — a coordinate on the
// family's one axis, not a character bias the way the forest's seasons are.
// Named from the real oceanography, not invented: epipelagic ("Sunlight
// Zone") down to "Glass Shallows"/"Reef Crest", the mesophotic edge of it to
// "Mesophotic Current", and the bathypelagic ("Midnight Zone") to "The
// Abyss" — kept colloquial rather than renamed to "Midnight", because that is
// how documentaries and aquariums actually talk about it. Three of the four
// still pin their zone every seed; "Glass Shallows" is a weighted MOSTLY
// rather than an absolute promise — see AboveWaterProbability in
// ocean_scene_profile.go for why turning that pin into a lean was deliberate.
// See OCEAN_MOOD_PROFILES in lib/oceanScene.ts and oceanMoodProfiles in
// ocean_scene_profile.go.
const oceanMoodOptions = [
  { label: "Glass Shallows", value: "focused", swatch: "#5EEAD4" },
  { label: "Mesophotic Current", value: "dreamy", swatch: "#A78BFA" },
  { label: "Reef Crest", value: "energetic", swatch: "#F2B24C" },
  { label: "The Abyss", value: "reflective", swatch: "#1E3A5F" }
];

// Everything the create page says differently per family, in one record typed
// by WorldFamily. It replaced a run of `worldFamily === "nature" ? ... : ...`
// ternaries, each of which quietly treated a third family as "universe" — the
// compiler now refuses to let a family be added without answering all of this.
const FAMILY_COPY: Record<
  WorldFamily,
  {
    noun: string;
    moodLabel: string;
    moodOptions: typeof moodOptions;
    chromeClassName: string;
    submitLabel: string;
    showsWorldStylePicker: boolean;
  }
> = {
  universe: {
    noun: "Universe",
    moodLabel: "Atmospheric Mood",
    moodOptions,
    chromeClassName: "",
    submitLabel: "Curate this universe",
    showsWorldStylePicker: true
  },
  nature: {
    noun: "Forest",
    moodLabel: "Forest Mood",
    moodOptions: natureMoodOptions,
    chromeClassName: "forest-chrome",
    submitLabel: "Curate this forest",
    showsWorldStylePicker: false
  },
  ocean: {
    noun: "Ocean",
    moodLabel: "Depth & Mood",
    moodOptions: oceanMoodOptions,
    chromeClassName: "forest-chrome",
    submitLabel: "Curate this ocean",
    showsWorldStylePicker: false
  }
};
const styleOptions = [
  { label: "Cosmic", value: "cosmic-galaxy", swatch: "#8B5CF6" },
  { label: "Nebula", value: "nebula", swatch: "#a855f7" },
  { label: "Crystal", value: "crystal", swatch: "#22d3ee" },
  { label: "Aurora", value: "aurora", swatch: "#34d399" },
  { label: "Cyber Orbit", value: "cyber-orbit", swatch: "#38bdf8" }
];
const colorOptions = ["#8B5CF6", "#06B6D4", "#F97316", "#22C55E", "#F43F5E", "#EAB308"];

// The live preview rebuilds the WebGL scene whenever its inputs change. Debounce
// so a burst of keystrokes/toggles only rebuilds the canvas once the user pauses,
// instead of tearing down and recreating the GL context on every character.
const PREVIEW_REBUILD_DEBOUNCE_MILLISECONDS = 300;

// The submit button is pinned in the rail footer, outside the <form> element, so
// it stays visible while the field column scrolls; this id wires it back to the
// form via the HTML `form` attribute.
const CREATE_FORM_ELEMENT_ID = "create-universe-form";

// Custom-interest limits mirror the backend validation exactly
// (validation/world.go: interests 3-8 items, each 2-32 characters), so a value
// accepted here is never rejected server-side.
const MINIMUM_INTEREST_CHARACTERS = 2;
const MAXIMUM_INTEREST_CHARACTERS = 32;
const MINIMUM_INTERESTS = 3;
const MAXIMUM_INTERESTS = 8;

function useDebouncedValue<ValueType>(value: ValueType, delayMilliseconds: number): ValueType {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timeoutId = setTimeout(() => setDebouncedValue(value), delayMilliseconds);
    return () => clearTimeout(timeoutId);
  }, [value, delayMilliseconds]);
  return debouncedValue;
}

export default function HomePage() {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [role, setRole] = useState("");
  const [goal, setGoal] = useState("");
  const [challenge, setChallenge] = useState("");
  const [interests, setInterests] = useState(["Technology", "Design", "AI"]);
  const [traits, setTraits] = useState(["curious", "builder", "focused"]);
  const [mood, setMood] = useState("focused");
  const [worldFamily, setWorldFamily] = useState<WorldFamily>("universe");
  const [preferredWorldStyle, setPreferredWorldStyle] = useState("cosmic-galaxy");
  const [favoriteColors, setFavoriteColors] = useState<string[]>(["#8B5CF6", "#06B6D4"]);
  const [customInterestDraft, setCustomInterestDraft] = useState("");
  const [isAddingCustomInterest, setIsAddingCustomInterest] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<GenerationJobStatus | undefined>();
  const {
    collapseState: formRailCollapseState,
    toggleCollapse,
    toggleButtonReference: formRailToggleButtonReference
  } = useWorldChromeCollapse({ errorMessage: error, worldFamily });

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
        addWorldIdentifierToGallery(result.world.id, result.family);
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

  const payload = useMemo(() => {
    const safeInterests = ensureRange(interests, ["Technology", "Design", "AI"], MINIMUM_INTERESTS, MAXIMUM_INTERESTS);
    const safeTraits = ensureRange(traits, ["curious", "builder", "focused"], 3, 6);
    const safeGoal =
      goal.trim() ||
      `Build a personal universe around ${safeInterests.slice(0, 3).join(", ")} with a ${safeTraits[0]} energy.`;

    return {
      nickname: nickname.trim() || "Neo",
      role: role.trim() || "Explorer",
      interests: safeInterests,
      traits: safeTraits,
      goal: safeGoal.slice(0, 220),
      challenge: challenge.trim() || undefined,
      mood,
      favoriteColors: favoriteColors.length ? favoriteColors : ["#8B5CF6"],
      preferredWorldStyle
    };
  }, [challenge, favoriteColors, goal, interests, mood, nickname, preferredWorldStyle, role, traits]);

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
  const previewScene = useMemo(() => {
    const previewInput = {
      nickname: debouncedPayload.nickname,
      interests: debouncedPayload.interests,
      traits: debouncedPayload.traits,
      mood: debouncedPayload.mood,
      preferredWorldStyle: debouncedPayload.preferredWorldStyle,
      favoriteColors: debouncedPayload.favoriteColors
    };
    // Same inputs, family-specific mirror: the preview always renders with the
    // exact renderer the generated world will use.
    if (worldFamily === "nature") {
      return buildPreviewForestSceneConfig(previewInput);
    }
    if (worldFamily === "ocean") {
      return buildPreviewOceanSceneConfig(previewInput, { showCalmSurfaceDefault: isPreviewUncustomized });
    }
    return buildPreviewSceneConfig(previewInput);
  }, [debouncedPayload, isPreviewUncustomized, worldFamily]);

  // The preview mounts the selected family immediately, so that chunk is already
  // in flight. Warm the others as well: this is the one page whose whole job is
  // choosing between families, and people flick the picker back and forth. A
  // spinner on every flick is a worse trade than bytes that arrive after first
  // paint. The world and share routes, which know their family for certain,
  // still fetch exactly one renderer.
  useEffect(() => {
    for (const option of familyOptions) {
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
      addWorldIdentifierToGallery(world.id, worldFamily);
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
    setFavoriteColors((current) => toggleItem(current, color, 1, 4));
  }

  // Commits the typed custom interest through the same toggleItem path the
  // predefined chips use, so the 8-item cap and dedupe hold automatically.
  // Returns whether the draft was accepted (too-short drafts are kept for
  // further typing rather than silently discarded).
  function commitCustomInterest(): boolean {
    const draftInterest = customInterestDraft.trim();
    if (draftInterest.length < MINIMUM_INTEREST_CHARACTERS) {
      return false;
    }
    setInterests((current) =>
      current.includes(draftInterest) ? current : toggleItem(current, draftInterest, MINIMUM_INTERESTS, MAXIMUM_INTERESTS)
    );
    setCustomInterestDraft("");
    return true;
  }

  function closeCustomInterestInput() {
    commitCustomInterest();
    setCustomInterestDraft("");
    setIsAddingCustomInterest(false);
  }

  function handleFormRailToggle() {
    // Commit a half-typed custom interest through the same path the input's
    // onBlur uses, rather than relying on the browser to blur it for us: the
    // rail is about to become invisible and the draft would be unreachable.
    // This is the create page's own concern, which is why the shared hook does
    // not know about it.
    closeCustomInterestInput();
    toggleCollapse();
  }

  return (
    <main
      className={`relative flex min-h-screen flex-col lg:block lg:h-screen lg:overflow-hidden ${
        FAMILY_COPY[worldFamily].chromeClassName
      }`}
    >
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

      {/* Full-bleed live world: a tall hero on mobile, the immersive background on
          desktop so the preview owns the screen and the rail floats over it. */}
      <div
        className={`relative min-h-[320px] w-full lg:absolute lg:inset-0 lg:h-full ${
          formRailCollapseState.reservesLayoutSpace ? "h-[46vh]" : "h-svh"
        }`}
      >
        <UniverseCanvas
          scene={previewScene}
          className="h-full"
          selectedPlanetKey={selectedPreviewPointKey}
          onSelectPlanet={handleSelectPreviewPoint}
          enableAmbientSound
        />

        {/* Floating identity island (desktop): live state, the curatorial
            accession, and the palette — opposite the form rail. Wrapped for the
            same reason the rail is: the panel's own .glass-rise retains a
            transform and .glass-panel is reset to `transform: none` under
            reduced motion, so the exit has to live on a plain ancestor. */}
        <div className="immersive-exit immersive-exit-right pointer-events-none absolute right-5 top-[72px] hidden w-[290px] lg:block">
        <div className="glass-panel glass-panel-glow glass-rise flex w-full flex-col gap-3 rounded-2xl px-4 py-3.5">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-vermillion shadow-[0_0_8px_rgba(224,87,58,0.8)]" aria-hidden="true" />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-grey">Live preview</span>
          </div>
          {/* The world's owner, live from the form (payload defaults keep it
              non-empty), so the placard reads like the mockup's title card. */}
          <div className="font-display text-lg font-semibold leading-tight text-paper">
            {payload.nickname}&rsquo;s {FAMILY_COPY[worldFamily].noun}
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-brass">Curated from</div>
            <div className="mt-1 font-mono text-sm text-paper">{payload.interests.slice(0, 3).join(" · ")}</div>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-brass">Palette</span>
            <div className="flex gap-1.5">
              {payload.favoriteColors.map((color) => (
                <span
                  key={color}
                  className="h-3.5 w-3.5 rounded-full border border-white/20"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
        </div>
        </div>
      </div>

      {/* Floating Liquid-Glass form rail: an in-flow card on mobile (pulled up over
          the hero), a floating glass island on the left on desktop where only the
          field column scrolls.

          The positioning lives on this WRAPPER rather than on the panel, and the
          wrapper deliberately carries neither .glass-panel nor .glass-rise: the
          entrance animation's retained transform and the reduced-motion
          `transform: none` on .glass-panel would each silently defeat a collapse
          applied to the panel itself. See .form-rail-collapse in globals.css.

          `h-0` only ever applies once the slide has finished, so the mobile page
          closes up under an already-invisible card instead of jumping while it
          is still on screen. */}
      <div
        id={FORM_RAIL_ELEMENT_ID}
        data-form-rail-collapsed={!formRailCollapseState.isExpanded}
        className={`form-rail-collapse relative z-10 sm:mx-4 lg:absolute lg:bottom-[68px] lg:left-6 lg:top-[72px] lg:mx-0 lg:mb-0 lg:mt-0 lg:w-[384px] ${
          formRailCollapseState.reservesLayoutSpace
            ? // The rail is in flow below lg while the footer is fixed over it, so
              // a plain gap left the submit button under the footer bar. The
              // desktop branch already reserves that height with lg:bottom.
              "mx-3 mb-[calc(var(--footer-height)+1rem)] mt-4"
            : "mx-3 mb-0 mt-0 h-0 overflow-hidden"
        }`}
      >
      <section className="glass-panel glass-panel-glow glass-rise flex w-full flex-col overflow-hidden rounded-3xl lg:h-full">
          <div className="border-b border-white/5 px-5 pb-5 pt-5 sm:px-7">
            <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-brass">Curate</div>
            <h1 className="font-display text-3xl font-semibold text-paper">A portrait of you.</h1>
            <p className="mt-2 text-sm text-grey">Your details are mounted as a world that is exactly, only, yours.</p>
          </div>

          <div className="rail-scroll min-h-0 flex-1 overflow-x-hidden lg:overflow-y-auto">
            <form id={CREATE_FORM_ELEMENT_ID} className="grid gap-5 px-5 py-6 sm:px-7" onSubmit={onSubmit}>
              <div className="grid gap-3">
                <span className="font-mono text-xs uppercase tracking-widest text-brass">World Family</span>
                <div className="grid grid-cols-2 gap-3">
                  {familyOptions.map((option) => {
                    const selected = worldFamily === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setWorldFamily(option.value)}
                        aria-pressed={selected}
                        className={`focus-ring glass-panel tappable relative rounded-xl border-2 p-3 text-center ${
                          selected
                            ? "scale-[1.03] border-brass bg-brass/10 ring-2 ring-brass/40"
                            : "border-transparent hover:border-white/20"
                        }`}
                      >
                        {selected ? (
                          <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-brass text-ink">
                            <Check className="h-3 w-3" aria-hidden="true" />
                          </span>
                        ) : null}
                        <option.Icon
                          className={`mx-auto mb-2 h-7 w-7 ${selected ? "text-brass" : "text-on-surface-variant"}`}
                          aria-hidden="true"
                        />
                        <span className={`block text-sm ${selected ? "font-semibold text-brass" : "text-on-surface"}`}>
                          {option.label}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-on-surface-variant">{option.description}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4">
                <label className="grid gap-2">
                  <span className="font-mono text-xs uppercase tracking-widest text-brass">Nickname</span>
                  <input
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                    className="focus-ring input-dark rounded-xl px-4 py-3 text-on-surface placeholder:text-outline"
                    placeholder="e.g. Neo"
                    maxLength={32}
                  />
                </label>
                <label className="grid gap-2">
                  <span className="font-mono text-xs uppercase tracking-widest text-brass">Primary Role</span>
                  <input
                    value={role}
                    onChange={(event) => setRole(event.target.value)}
                    className="focus-ring input-dark rounded-xl px-4 py-3 text-on-surface placeholder:text-outline"
                    placeholder="e.g. Explorer, Creator"
                    maxLength={80}
                  />
                </label>
              </div>

              <div className="grid gap-3">
                <span className="font-mono text-xs uppercase tracking-widest text-brass">Core Interests</span>
                <div className="flex flex-wrap gap-2">
                  {interestOptions.map((item) => {
                    const selected = interests.includes(item);
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setInterests((current) => toggleItem(current, item, MINIMUM_INTERESTS, MAXIMUM_INTERESTS))}
                        className={`focus-ring tappable rounded-full border px-4 py-1.5 text-sm ${
                          selected
                            ? "border-primary bg-primary/35 font-semibold text-paper"
                            : "border-white/15 bg-white/5 text-on-surface-variant hover:border-white/35 hover:text-on-surface"
                        }`}
                      >
                        {item}
                      </button>
                    );
                  })}
                  {/* Custom interests live in the same selection array as the
                      predefined chips; clicking one removes it (min 3 holds). */}
                  {interests
                    .filter((item) => !interestOptions.includes(item))
                    .map((item) => (
                      <button
                        key={item}
                        type="button"
                        aria-pressed="true"
                        onClick={() => setInterests((current) => toggleItem(current, item, MINIMUM_INTERESTS, MAXIMUM_INTERESTS))}
                        className="focus-ring tappable rounded-full border border-primary bg-primary/35 px-4 py-1.5 text-sm font-semibold text-paper"
                      >
                        {item}
                      </button>
                    ))}
                  {isAddingCustomInterest ? (
                    <input
                      autoFocus
                      value={customInterestDraft}
                      onChange={(event) => setCustomInterestDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          // Enter adds the interest; without this the form submits.
                          event.preventDefault();
                          commitCustomInterest();
                        }
                        if (event.key === "Escape") {
                          setCustomInterestDraft("");
                          setIsAddingCustomInterest(false);
                        }
                      }}
                      onBlur={closeCustomInterestInput}
                      maxLength={MAXIMUM_INTEREST_CHARACTERS}
                      placeholder="Your own interest"
                      aria-label="Add a custom interest (2-32 characters)"
                      className="focus-ring w-40 rounded-full border border-primary/50 bg-transparent px-4 py-1.5 text-sm text-on-surface placeholder:text-outline"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsAddingCustomInterest(true)}
                      disabled={interests.length >= MAXIMUM_INTERESTS}
                      className="focus-ring tappable inline-flex items-center gap-1 rounded-full border border-dashed border-white/20 bg-white/5 px-4 py-1.5 text-sm text-on-surface-variant hover:border-primary/40 hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      Custom
                    </button>
                  )}
                </div>
              </div>

              <div className="grid gap-3">
                <span className="font-mono text-xs uppercase tracking-widest text-brass">Traits</span>
                <div className="flex flex-wrap gap-2">
                  {traitOptions.map((item) => {
                    const selected = traits.includes(item);
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setTraits((current) => toggleItem(current, item, 3, 6))}
                        className={`focus-ring tappable rounded-full border px-4 py-1.5 text-sm capitalize ${
                          selected
                            ? "border-secondary bg-secondary/30 font-semibold text-paper"
                            : "border-white/15 bg-white/5 text-on-surface-variant hover:border-white/35 hover:text-on-surface"
                        }`}
                      >
                        {item}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="grid gap-2">
                <span className="font-mono text-xs uppercase tracking-widest text-brass">Goal</span>
                <textarea
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  className="focus-ring input-dark min-h-24 resize-y rounded-xl px-4 py-3 text-on-surface placeholder:text-outline"
                  placeholder="Build a beautiful AI product that feels personal and useful."
                  maxLength={220}
                />
              </label>

              <label className="grid gap-2">
                <span className="font-mono text-xs uppercase tracking-widest text-brass">Hidden Challenge</span>
                <input
                  value={challenge}
                  onChange={(event) => setChallenge(event.target.value)}
                  className="focus-ring input-dark rounded-xl px-4 py-3 text-on-surface placeholder:text-outline"
                  placeholder="e.g. I overthink product direction"
                  maxLength={220}
                />
              </label>

              <div className="grid gap-3">
                <span className="font-mono text-xs uppercase tracking-widest text-brass">
                  {FAMILY_COPY[worldFamily].moodLabel}
                </span>
                <div className="grid grid-cols-2 gap-3">
                  {FAMILY_COPY[worldFamily].moodOptions.map((option) => {
                    const selected = mood === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setMood(option.value)}
                        aria-pressed={selected}
                        className={`focus-ring glass-panel tappable relative rounded-xl border-2 p-3 text-center ${
                          selected
                            ? "scale-[1.03] border-secondary bg-secondary/15 ring-2 ring-secondary/40"
                            : "border-transparent hover:border-white/20"
                        }`}
                      >
                        {selected ? (
                          <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-brass text-ink">
                            <Check className="h-3 w-3" aria-hidden="true" />
                          </span>
                        ) : null}
                        <span className="mb-2 block h-8 rounded" style={{ backgroundColor: option.swatch }} />
                        <span className={`text-sm ${selected ? "font-semibold text-brass" : "text-on-surface"}`}>
                          {option.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* World Style only shapes universe visuals (sky/orbit themes);
                  the forest's look comes from mood/season and the ocean's from
                  mood/depth, so the section hides for both (their stored theme
                  keeps its default). */}
              <div className={FAMILY_COPY[worldFamily].showsWorldStylePicker ? "grid gap-3" : "hidden"}>
                <span className="font-mono text-xs uppercase tracking-widest text-brass">World Style</span>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {styleOptions.map((option) => {
                    const selected = preferredWorldStyle === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setPreferredWorldStyle(option.value)}
                        aria-pressed={selected}
                        className={`focus-ring glass-panel tappable relative rounded-xl border-2 p-3 text-center ${
                          selected
                            ? "scale-[1.03] border-primary bg-primary/15 ring-2 ring-primary/40"
                            : "border-transparent hover:border-white/20"
                        }`}
                      >
                        {selected ? (
                          <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-brass text-ink">
                            <Check className="h-3 w-3" aria-hidden="true" />
                          </span>
                        ) : null}
                        <span className="mb-2 block h-8 rounded" style={{ backgroundColor: option.swatch }} />
                        <span className={`text-sm ${selected ? "font-semibold text-brass" : "text-on-surface"}`}>
                          {option.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-2">
                <span className="font-mono text-xs uppercase tracking-widest text-brass">Palette</span>
                <div className="flex flex-wrap gap-2">
                  {colorOptions.map((color) => {
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

          <div className="grid gap-3 border-t border-white/10 px-5 py-4 sm:px-7">
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
