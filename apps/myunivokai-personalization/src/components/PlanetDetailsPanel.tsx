"use client";

import { Orbit } from "lucide-react";
import type { PlanetSceneConfig } from "@/lib/types";
import { planetIdentityKey } from "@/features/scene-renderers/planetIdentity";

const ENERGY_BAR_MAXIMUM_VALUE = 100;

// A point of interest carries its own colour from the world's palette. When it
// does not, fall back to the accent metal rather than to a hard-coded violet:
// an unnamed colour should look like chrome, not like a seventh palette entry.
const FALLBACK_POINT_OF_INTEREST_COLOR = "var(--brass)";

type PlanetDetailsPanelProps = {
  planets: PlanetSceneConfig[];
  selectedPlanetKey: string | null;
  onSelectPlanet: (planet: PlanetSceneConfig | null) => void;
};

function clampEnergyValue(energy?: number): number {
  if (typeof energy !== "number" || Number.isNaN(energy)) {
    return 0;
  }
  return Math.max(0, Math.min(ENERGY_BAR_MAXIMUM_VALUE, energy));
}

export function PlanetDetailsPanel({ planets, selectedPlanetKey, onSelectPlanet }: PlanetDetailsPanelProps) {
  if (planets.length === 0) {
    return null;
  }

  const selectedPlanet = planets.find(
    (planet, planetIndex) => planetIdentityKey(planet, planetIndex) === selectedPlanetKey
  );

  return (
    <div className="glass-panel glass-rise rounded-2xl p-4">
      <div className="mb-3 flex items-center gap-2">
        <Orbit className="h-4 w-4 text-brass" aria-hidden="true" />
        <h2 className="font-display text-base font-semibold text-paper">World DNA</h2>
      </div>

      <ul className="grid gap-2">
        {planets.map((planet, planetIndex) => {
          const identityKey = planetIdentityKey(planet, planetIndex);
          const isSelected = identityKey === selectedPlanetKey;
          const energyValue = clampEnergyValue(planet.energy);
          return (
            <li key={identityKey}>
              <button
                type="button"
                onClick={() => onSelectPlanet(isSelected ? null : planet)}
                // A translucent dark veil, not the opaque card this used to be:
                // the rest of the chrome is clear glass now, and a solid
                // #222028 block read as a leftover pasted over the world. The
                // veil is still see-through, but it gives the label and the
                // number a consistent floor over a bright, busy scene — the
                // rows are the densest text on the page.
                className={`focus-ring w-full rounded-xl border p-3 text-left transition ${
                  isSelected
                    ? "border-brass/55 bg-brass/20"
                    : "border-hairline bg-black/30 hover:border-white/30 hover:bg-black/40"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-semibold text-paper">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: planet.color ?? FALLBACK_POINT_OF_INTEREST_COLOR }}
                      aria-hidden="true"
                    />
                    {planet.name ?? "Unknown planet"}
                  </span>
                  <span className="font-mono text-xs text-paper">{energyValue}</span>
                </div>
                {/* The bar takes the point's OWN colour, the same one as its dot.
                    It used to be the accent metal, which put two colour systems
                    in every row — a cyan dot beside a copper bar, neither
                    agreeing with the other or with the chrome. One hue per row
                    reads as that row's identity instead of as decoration. */}
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/45">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${energyValue}%`,
                      backgroundColor: planet.color ?? FALLBACK_POINT_OF_INTEREST_COLOR
                    }}
                  />
                </div>
                {isSelected && planet.meaning ? (
                  // Caption-plate: the planet's meaning, set off by a brass rule —
                  // "every planet maps to a real input with a stated meaning".
                  <p className="mt-3 border-t border-brass/25 pt-3 text-sm leading-6 text-grey">{planet.meaning}</p>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
