import type { WorldFamily } from "@/lib/types";
import { ForestLoaderMark } from "./ForestLoaderMark";
import { OceanLoaderMark } from "./OceanLoaderMark";
import { UniverseLoaderMark } from "./UniverseLoaderMark";
import type { WorldLoader } from "./types";

/**
 * One loader per world family, and the compiler will not accept a family
 * without one.
 *
 * A `Record<WorldFamily, WorldLoader>` rather than a lookup with a fallback, for
 * exactly the reason `RENDERER_IMPORTS_BY_FAMILY` is one: a fallback would let a
 * fourth family ship showing the universe's orbit while its own world was being
 * built, and nobody would find out until someone noticed the wrong world's
 * colours on the wrong wait. A missing entry here is a build failure, which is
 * the only place that mistake is cheap.
 *
 * The ground colours are not invented. Each pair brackets the real backgrounds
 * that family's scenes actually use — `MOOD_PROFILES[*].backgroundColor` for the
 * universe, `BACKGROUND_COLORS_BY_SEASON` for the forest,
 * `OCEAN_BACKGROUND_COLORS_BY_ZONE` for the ocean — so the hold is already the
 * colour of the place the visitor is going, and the arriving world unfolds onto
 * a ground it belongs on rather than onto a neutral one it has to replace.
 */
export const WORLD_LOADERS: Record<WorldFamily, WorldLoader> = {
  universe: {
    groundClassName: "world-loader-ground world-loader-ground-universe",
    Mark: UniverseLoaderMark,
    waitingLabel: "Building your universe."
  },
  nature: {
    groundClassName: "world-loader-ground world-loader-ground-nature",
    Mark: ForestLoaderMark,
    waitingLabel: "Growing your forest."
  },
  ocean: {
    groundClassName: "world-loader-ground world-loader-ground-ocean",
    Mark: OceanLoaderMark,
    waitingLabel: "Filling your ocean."
  }
};

export function worldLoaderForFamily(family: WorldFamily): WorldLoader {
  return WORLD_LOADERS[family];
}
