import {
  CircleDashed,
  CircuitBoard,
  Cloud,
  CloudFog,
  Eclipse,
  Fish,
  Flame,
  Flower2,
  Gem,
  Lamp,
  Leaf,
  Moon,
  Orbit,
  Rainbow,
  Satellite,
  Shell,
  Snowflake,
  Sparkles,
  Sprout,
  Sun,
  TreePine,
  Trees,
  Waves,
  Wheat
} from "lucide-react";
import type { SwatchOption } from "@/components/SwatchChipGroup";
import type { WorldFamily } from "@/lib/types";

/**
 * Every vocabulary the create-world form offers, in one module, because two
 * screens now offer them.
 *
 * The account profile page (features/identity/AccountProfileForm.tsx) saves
 * defaults for exactly these fields, and a second copy of these lists is how
 * the two would come to disagree — one screen offering a mood the other cannot
 * render, or a style the backend refuses for the chosen family. Each list
 * mirrors a backend vocabulary (allowedMoods and allowedWorldStylesByFamily in
 * contracts/go/contracts.go), so there is already one place they must agree
 * with, and adding a third would be worse than adding a second.
 *
 * Moved here verbatim from app/page.tsx, with the constants renamed to
 * UPPER_SNAKE_CASE per agent-system/rules/coding-style.md and nothing else
 * changed.
 */

// The world-family picker: which backend curates the portrait. Universe =
// universe-service (solar system), Forest = nature-service (living forest),
// Ocean = ocean-service (a sea at one depth). Same inputs, same mechanism —
// only the scene family differs.
export const FAMILY_OPTIONS: { label: string; value: WorldFamily; description: string; Icon: typeof Orbit }[] = [
  { label: "Universe", value: "universe", description: "A solar system of you", Icon: Orbit },
  { label: "Forest", value: "nature", description: "A living forest of you", Icon: Trees },
  { label: "Ocean", value: "ocean", description: "A sea of you, at depth", Icon: Waves }
];

export const INTEREST_OPTIONS = ["Technology", "Art", "Science", "Design", "Music", "AI", "Storytelling", "Product"];
export const TRAIT_OPTIONS = ["curious", "builder", "focused", "creative", "calm", "explorer"];
// Same four mood VALUES for every family (the backend contract keys off
// them); only the label/swatch changes so the card reads in the family's own
// language — universe moods are cosmic, forest moods are seasonal (each label
// names the season that mood leans toward in the forest builder).
export const UNIVERSE_MOOD_OPTIONS: readonly SwatchOption[] = [
  { label: "Cybernetic", value: "focused", swatch: "#3b82f6", Icon: CircuitBoard },
  { label: "Nebula", value: "dreamy", swatch: "#a855f7", Icon: Sparkles },
  { label: "Solar", value: "energetic", swatch: "#eab308", Icon: Sun },
  { label: "Void", value: "reflective", swatch: "#ef4444", Icon: CircleDashed }
];
export const NATURE_MOOD_OPTIONS: readonly SwatchOption[] = [
  { label: "Frostwood", value: "focused", swatch: "#93C5FD", Icon: Snowflake },
  { label: "Blossom", value: "dreamy", swatch: "#F9A8D4", Icon: Flower2 },
  { label: "Summer Meadow", value: "energetic", swatch: "#4ADE80", Icon: Wheat },
  { label: "Amber Autumn", value: "reflective", swatch: "#F59E0B", Icon: Leaf }
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
export const OCEAN_MOOD_OPTIONS: readonly SwatchOption[] = [
  // The icons here name the DEPTH, because that is what these four options
  // actually are: sun at the surface, the twilight edge of the light, the reef
  // where the fauna is, and the moon for the midnight zone.
  { label: "Glass Shallows", value: "focused", swatch: "#5EEAD4", Icon: Sun },
  { label: "Mesophotic Current", value: "dreamy", swatch: "#A78BFA", Icon: Eclipse },
  { label: "Reef Crest", value: "energetic", swatch: "#F2B24C", Icon: Fish },
  { label: "The Abyss", value: "reflective", swatch: "#1E3A5F", Icon: Moon }
];

// World Style, one vocabulary per family, mirroring allowedWorldStylesByFamily
// in contracts/go/contracts.go. Posting one family's style to another is a 400.
//
// It used to be these five for everyone, and nature-service and ocean-service
// stored whichever arrived and never read it — so the picker was hidden for
// both rather than left offering a control that changed nothing. Each family
// now has its own axis and its own service reads it.
//
// THE FIRST ENTRY OF EVERY FAMILY IS ITS NEUTRAL STYLE: the world as the
// builder already made it. That is what lets the picker come back without
// changing a single stored world.
export const UNIVERSE_STYLE_OPTIONS: readonly SwatchOption[] = [
  { label: "Cosmic", value: "cosmic-galaxy", swatch: "#8B5CF6", Icon: Orbit },
  // A cloud, not the sparkles the Nebula MOOD carries. The two have shared a
  // name in this form since it was written, and until now they also looked
  // identical in a list of coloured dots.
  { label: "Nebula", value: "nebula", swatch: "#a855f7", Icon: Cloud },
  { label: "Crystal", value: "crystal", swatch: "#22d3ee", Icon: Gem },
  { label: "Aurora", value: "aurora", swatch: "#34d399", Icon: Rainbow },
  { label: "Cyber Orbit", value: "cyber-orbit", swatch: "#38bdf8", Icon: Satellite }
];

// Mood decides the forest's season; style decides how it is grown and lit.
// See forest_style_profile.go and the mirror in lib/forestScene.ts.
export const NATURE_STYLE_OPTIONS: readonly SwatchOption[] = [
  { label: "Wildwood", value: "wildwood", swatch: "#7CB463", Icon: Trees },
  { label: "Ancient Grove", value: "ancient-grove", swatch: "#4E7A54", Icon: TreePine },
  { label: "Mistwood", value: "mistwood", swatch: "#B8C7CE", Icon: CloudFog },
  { label: "Emberfall", value: "emberfall", swatch: "#E07A3C", Icon: Flame },
  { label: "Lanternwood", value: "lanternwood", swatch: "#F2C464", Icon: Lamp }
];

// Mood decides the ocean's depth; style decides the water and what lives in it.
// See ocean_style_profile.go and the mirror in lib/oceanScene.ts.
export const OCEAN_STYLE_OPTIONS: readonly SwatchOption[] = [
  { label: "Open Water", value: "open-water", swatch: "#38A7C7", Icon: Waves },
  { label: "Coral Garden", value: "coral-garden", swatch: "#F2775A", Icon: Shell },
  { label: "Kelp Cathedral", value: "kelp-cathedral", swatch: "#5A9E6F", Icon: Sprout },
  { label: "Crystal Shoal", value: "crystal-shoal", swatch: "#7DD3FC", Icon: Gem },
  { label: "Silt Drift", value: "silt-drift", swatch: "#9CA3AF", Icon: CloudFog }
];
// Everything the create page says differently per family, in one record typed
// by WorldFamily. It replaced a run of `worldFamily === "nature" ? ... : ...`
// ternaries, each of which quietly treated a third family as "universe" — the
// compiler now refuses to let a family be added without answering all of this.
export const FAMILY_COPY: Record<
  WorldFamily,
  {
    noun: string;
    moodLabel: string;
    moodOptions: readonly SwatchOption[];
    /** The field label for World Style — each family styles a different thing. */
    styleLabel: string;
    styleOptions: readonly SwatchOption[];
    chromeClassName: string;
    submitLabel: string;
  }
> = {
  universe: {
    noun: "Universe",
    moodLabel: "Atmospheric Mood",
    moodOptions: UNIVERSE_MOOD_OPTIONS,
    styleLabel: "World Style",
    styleOptions: UNIVERSE_STYLE_OPTIONS,
    chromeClassName: "",
    submitLabel: "Curate this universe"
  },
  nature: {
    noun: "Forest",
    moodLabel: "Forest Mood",
    moodOptions: NATURE_MOOD_OPTIONS,
    styleLabel: "Forest Style",
    styleOptions: NATURE_STYLE_OPTIONS,
    chromeClassName: "forest-chrome",
    submitLabel: "Curate this forest"
  },
  ocean: {
    noun: "Ocean",
    moodLabel: "Depth & Mood",
    moodOptions: OCEAN_MOOD_OPTIONS,
    styleLabel: "Water & Life",
    styleOptions: OCEAN_STYLE_OPTIONS,
    chromeClassName: "forest-chrome",
    submitLabel: "Curate this ocean"
  }
};

/**
 * The neutral style of a family — its first option, which every family's
 * service treats as a no-op. Switching family has to swap the stored style with
 * it, because a style belongs to exactly one family now and posting the wrong
 * one is a 400 from the gateway.
 */
export function defaultStyleForFamily(family: WorldFamily): string {
  return FAMILY_COPY[family].styleOptions[0].value;
}
export const COLOR_OPTIONS = ["#8B5CF6", "#06B6D4", "#F97316", "#22C55E", "#F43F5E", "#EAB308"];
