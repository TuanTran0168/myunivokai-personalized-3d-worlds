"use client";

import { useThree } from "@react-three/fiber";
import { nodeMaterialModulesFor, type NodeMaterialModules } from "./nodeMaterials";

/**
 * The node modules if this scene is being drawn by a node renderer, else null.
 *
 * Null is the ordinary answer — it is what every visitor gets today — and it
 * means "build the classic material". See `nodeMaterials.ts` for why both
 * implementations exist at once and why this is not read from a module-level
 * cache.
 *
 * A separate file from `nodeMaterials.ts` so that module stays free of React:
 * it is called from `forestModels.ts`, which walks a parsed GLB and is not a
 * component, and from tests that mount nothing.
 *
 * The value is stable for the life of a `<Canvas>`: the renderer instance
 * cannot change without a remount, and the modules are loaded before the first
 * child mounts. Safe to put in a `useMemo` dependency list, which is where
 * every caller puts it.
 */
export function useNodeMaterialModules(): NodeMaterialModules | null {
  const renderer = useThree((state) => state.gl);
  return nodeMaterialModulesFor(renderer);
}
