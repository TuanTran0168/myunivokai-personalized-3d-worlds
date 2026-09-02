"use client";

import { lazy } from "react";
import type { SceneConfig, WorldFamily } from "@/lib/types";
import { configureLocalModelDecoders } from "./shared/modelDecoders";
import type { SceneRendererComponent } from "./types";

/**
 * Run before any renderer chunk is even requested, let alone rendered.
 *
 * Most `.glb` models here are DRACO-compressed and drei's default decoder path
 * is a Google host, which the Content-Security-Policy blocks. `useGLTF` is
 * called during render inside the lazy chunks below, so this cannot be an
 * effect anywhere — by the time any effect ran, the first model of the first
 * scene would already have asked for a decoder. See ./shared/modelDecoders.ts.
 */
configureLocalModelDecoders();

/**
 * Each family renderer is its own chunk, so a visitor who opens a forest never
 * downloads the solar system and vice versa. The chunk boundary comes from the
 * dynamic import() itself, not from the wrapper around it.
 *
 * The loaders are named rather than inlined because prefetching has to go
 * through the SAME import() call the chunk resolves through — a second,
 * separately written import() of the same module is a second request.
 */
const importSolarSystemRenderer = () =>
  import("./solar-system/SolarSystemRenderer").then((module) => ({ default: module.SolarSystemRenderer }));
const importForestRenderer = () =>
  import("./forest/ForestRenderer").then((module) => ({ default: module.ForestRenderer }));
const importOceanRenderer = () =>
  import("./ocean/OceanRenderer").then((module) => ({ default: module.OceanRenderer }));

/**
 * React.lazy, deliberately NOT next/dynamic.
 *
 * next/dynamic (14.2.x) does not suspend — its loadable runtime renders a
 * `loading` component, defaulting to null, while the chunk is in flight. The
 * renderer shares its Suspense boundary in UniverseCanvas with SceneReadySignal,
 * so a non-suspending wrapper would let that signal mount immediately, lift the
 * opacity veil and show an empty canvas until the chunk landed.
 *
 * React.lazy throws the promise instead, so the existing
 * <Suspense fallback={<CanvasLoader />}> catches it and the veil behaves exactly
 * as it did when only asset loading could suspend.
 *
 * No `ssr: false` equivalent is needed: a scene renderer only ever mounts inside
 * the r3f <Canvas> root, whose children are rendered by the r3f reconciler on
 * the client and are never part of the server-rendered tree.
 */
const SolarSystemRenderer = lazy(importSolarSystemRenderer);
const ForestRenderer = lazy(importForestRenderer);
const OceanRenderer = lazy(importOceanRenderer);

/**
 * Two-level renderer resolution:
 *
 * 1. `sceneType` picks the scene family — it is the contract key each backend
 *    service stamps into its configs ("forest" from nature-service; universe
 *    configs predate the field and simply omit it). A family match wins
 *    outright, so a forest world can never fall into a solar-system renderer
 *    no matter what its theme says.
 * 2. Within the universe family, `theme` picks the renderer exactly as before.
 *
 * Adding a scene family = new folder under scene-renderers/ implementing
 * SceneRendererProps + one lazy loader + one entry in
 * SCENE_TYPE_RENDERER_REGISTRY. The backend contract does not change.
 */
const SCENE_TYPE_RENDERER_REGISTRY: Record<string, SceneRendererComponent> = {
  forest: ForestRenderer,
  ocean: OceanRenderer
};

const SCENE_RENDERER_REGISTRY: Record<string, SceneRendererComponent> = {
  "cosmic-galaxy": SolarSystemRenderer,
  nebula: SolarSystemRenderer,
  crystal: SolarSystemRenderer,
  aurora: SolarSystemRenderer,
  "cyber-orbit": SolarSystemRenderer
};

export const DEFAULT_SCENE_RENDERER: SceneRendererComponent = SolarSystemRenderer;

export function resolveSceneRenderer(theme?: string): SceneRendererComponent {
  if (theme && SCENE_RENDERER_REGISTRY[theme]) {
    return SCENE_RENDERER_REGISTRY[theme];
  }
  return DEFAULT_SCENE_RENDERER;
}

/**
 * Family-first resolution. Returns the family renderer when the scene carries
 * a registered sceneType, otherwise null so the caller can apply its
 * universe-era fallback rules (theme lookup / abstract fallback renderer).
 */
export function resolveSceneTypeRenderer(scene?: SceneConfig): SceneRendererComponent | null {
  if (scene?.sceneType && SCENE_TYPE_RENDERER_REGISTRY[scene.sceneType]) {
    return SCENE_TYPE_RENDERER_REGISTRY[scene.sceneType];
  }
  return null;
}

/**
 * Warm a family's chunk before its scene config exists.
 *
 * Without this the split would trade bundle size for a visible extra round
 * trip: the renderer only starts downloading once the world response arrives.
 * Every caller already knows its family earlier than that — the share routes
 * carry it in the path, the world page in `?family=`, the create form in its
 * picker — so the chunk can travel alongside the world request instead of
 * after it.
 *
 * Safe to call repeatedly; the module registry resolves a loaded chunk from
 * cache.
 */
const RENDERER_IMPORTS_BY_FAMILY: Record<WorldFamily, () => Promise<unknown>> = {
  universe: importSolarSystemRenderer,
  nature: importForestRenderer,
  ocean: importOceanRenderer
};

export function prefetchSceneRendererForFamily(family: WorldFamily): void {
  // A record typed by WorldFamily rather than a ternary chain: the compiler
  // refuses to let a new family be added without a chunk to prefetch, where a
  // ternary would silently warm the solar system for it instead.
  void RENDERER_IMPORTS_BY_FAMILY[family]();
}
