import type { ComponentType } from "react";
import type { PlanetSceneConfig, SceneConfig } from "@/lib/types";

/**
 * Contract every scene renderer must implement.
 *
 * A scene renderer is mounted inside the shared <Canvas> shell (UniverseCanvas)
 * and receives the backend WorldSceneConfig plus interaction state. This keeps
 * renderers swappable: solar system today, sky/city/countryside in the future.
 */
export type SceneRendererProps = {
  scene: SceneConfig;
  seed: string;
  selectedPlanetKey: string | null;
  hoveredPlanetKey: string | null;
  onHoverPlanet: (planet: PlanetSceneConfig | null) => void;
  onSelectPlanet?: (planet: PlanetSceneConfig | null) => void;
};

export type SceneRendererComponent = ComponentType<SceneRendererProps>;
