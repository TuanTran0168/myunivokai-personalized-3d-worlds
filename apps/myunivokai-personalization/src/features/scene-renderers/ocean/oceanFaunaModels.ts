/**
 * Which downloaded GLB each ocean-1 fauna key resolves to, and which of its
 * animation clips may be played.
 *
 * The clip list is not decoration. These models were authored for a fishing
 * game and ship `Attack`, `Death` and `Out_Of_Water` alongside the swim cycles.
 * A portrait scene must never play any of those, and "play clip index 0" is one
 * re-export away from a fish dying on screen — so the swim clip is selected BY
 * NAME, with an explicit deny list behind it.
 *
 * Species were assigned by silhouette and by depth, not by name. A lionfish in
 * the abyss would be as wrong as an anglerfish on a reef.
 */

export const OCEAN_MODEL_BASE_PATH = "/assets/ocean/models";

export type FaunaModelBinding = {
  /** File under OCEAN_MODEL_BASE_PATH. */
  file: string;
  /**
   * Length of the model along its own forward axis, in metres, used to convert
   * the swim-speed body-lengths-per-second into scene units. Taken from the
   * real animal rather than from the file, because the files are not to scale
   * with each other.
   */
  bodyLengthMetres: number;
};

/** Clip names that mean "swimming", in the order they are preferred. */
export const SWIM_CLIP_PREFERENCE = ["Swimming_Normal", "Swim", "Swimming_Fast", "Swimming_Impulse"];

/**
 * Clips that must never play, matched case-insensitively against the clip name.
 * `Out_Of_Water` is in here for the obvious reason and `Attack` because a reef
 * school lunging in unison reads as a horror film rather than as a portrait.
 */
export const FORBIDDEN_CLIP_FRAGMENTS = ["death", "attack", "out_of_water", "hitreact", "damage"];

export const FISH_MODEL_BINDINGS: Record<string, FaunaModelBinding> = {
  // Reef: small, bright, schooling.
  "fish-reef-school": { file: "fauna-butterfly-fish.glb", bodyLengthMetres: 0.15 },
  "fish-silverside": { file: "fauna-piranha.glb", bodyLengthMetres: 0.12 },
  // Open-water predator: long body, rigid forebody.
  "fish-barracuda": { file: "fauna-swordfish.glb", bodyLengthMetres: 1.5 },
  "fish-ray": { file: "fauna-manta-ray.glb", bodyLengthMetres: 1.8 },
  // Deep sea: the two that are neither bright nor fast.
  "fish-lanternfish": { file: "fauna-turbot.glb", bodyLengthMetres: 0.08 },
  "fish-hatchetfish": { file: "fauna-blobfish.glb", bodyLengthMetres: 0.1 }
};

export const GIANT_MODEL_BINDINGS: Record<string, FaunaModelBinding> = {
  "giant-humpback": { file: "fauna-whale.glb", bodyLengthMetres: 14 },
  "giant-blue-whale": { file: "fauna-whale.glb", bodyLengthMetres: 25 },
  "giant-sperm-whale": { file: "fauna-whale.glb", bodyLengthMetres: 16 },
  "giant-whale-shark": { file: "fauna-shark.glb", bodyLengthMetres: 9 },
  "giant-manta": { file: "fauna-manta-ray.glb", bodyLengthMetres: 5.5 }
};

/** The abyssal-visitor lottery species, whose order is frozen in contracts. */
export const ABYSS_VISITOR_MODEL_BINDINGS: Record<string, FaunaModelBinding> = {
  // Quaternius via Poly Pizza, same pack and rig as the twelve above (same
  // Fish_Armature|Swimming_* / Attack / Death / Out_Of_Water clip set) — found
  // after the fact, not at the time "no CC0 anglerfish was found" was written.
  // No CC0 gulper eel exists yet, so that one stays on the goblin shark's
  // silhouette. The giant squid has no binding at all and keeps its procedural
  // geometry — a squid drawn as a shark would be worse than one from primitives.
  anglerfish: { file: "fauna-anglerfish.glb", bodyLengthMetres: 0.6 },
  "gulper-eel": { file: "fauna-goblin-shark.glb", bodyLengthMetres: 0.8 }
};

export function faunaModelUrl(binding: FaunaModelBinding): string {
  return `${OCEAN_MODEL_BASE_PATH}/${binding.file}`;
}

export function fishModelBinding(modelKey: string): FaunaModelBinding | null {
  return FISH_MODEL_BINDINGS[modelKey] ?? null;
}

export function giantModelBinding(modelKey: string): FaunaModelBinding | null {
  return GIANT_MODEL_BINDINGS[modelKey] ?? null;
}

/**
 * Picks the clip to play from what a file actually ships.
 *
 * Returns null rather than falling back to clip 0 when nothing matches: a
 * silent, still fish is a visible bug someone will fix, and a fish playing its
 * death animation on a loop is one nobody will notice until a user does.
 */
export function selectSwimClipName(available: string[]): string | null {
  const permitted = available.filter(
    (name) => !FORBIDDEN_CLIP_FRAGMENTS.some((fragment) => name.toLowerCase().includes(fragment))
  );
  for (const preferred of SWIM_CLIP_PREFERENCE) {
    const match = permitted.find((name) => name.toLowerCase().includes(preferred.toLowerCase()));
    if (match) {
      return match;
    }
  }
  return null;
}

/** Every GLB the catalogue can reach, for preloading. */
export function allFaunaModelUrls(): string[] {
  const files = new Set<string>();
  for (const bindings of [FISH_MODEL_BINDINGS, GIANT_MODEL_BINDINGS, ABYSS_VISITOR_MODEL_BINDINGS]) {
    for (const binding of Object.values(bindings)) {
      files.add(binding.file);
    }
  }
  return [...files].sort().map((file) => `${OCEAN_MODEL_BASE_PATH}/${file}`);
}
