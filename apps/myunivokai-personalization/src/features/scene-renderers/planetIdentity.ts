import type { PlanetSceneConfig } from "@/lib/types";

export function planetIdentityKey(planet: PlanetSceneConfig, planetIndex: number): string {
  return planet.key ?? planet.name ?? `planet-${planetIndex}`;
}
