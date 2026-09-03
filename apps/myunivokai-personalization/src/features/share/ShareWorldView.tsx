"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { api, apiErrorMessage, DEFAULT_WORLD_FAMILY } from "@/lib/api";
import type { PlanetSceneConfig, ShareWorld, WorldFamily } from "@/lib/types";
import { isForestScene, pointsOfInterestFromScene, sceneFromVariant } from "@/lib/scene";
import { UniverseCanvas } from "@/components/UniverseCanvas";
import { planetIdentityKey } from "@/features/scene-renderers/planetIdentity";
import { prefetchSceneRendererForFamily } from "@/features/scene-renderers/registry";
import { PlanetDetailsPanel } from "@/components/PlanetDetailsPanel";
import { RareFeatureBadge } from "@/components/RareFeatureBadge";
import { StatusMessage } from "@/components/StatusMessage";
import { useWorldChromeCollapse, WorldChromeToggle } from "@/components/WorldChromeToggle";
import { WORLD_PANELS_ELEMENT_ID } from "@/lib/formRailCollapse";

type ShareWorldViewProps = {
  shareSlug: string;
  // Which backend published this slug: /share/worlds/... renders universe
  // shares, /nature/share/worlds/... renders nature (forest) shares.
  family?: WorldFamily;
};

export function ShareWorldView({ shareSlug, family = DEFAULT_WORLD_FAMILY }: ShareWorldViewProps) {
  const [world, setWorld] = useState<ShareWorld | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedPlanetKey, setSelectedPlanetKey] = useState<string | null>(null);
  // A load failure replaces this whole view rather than rendering inside the
  // panels, so there is no error that hiding them could swallow.
  const { collapseState, toggleCollapse, toggleButtonReference } = useWorldChromeCollapse({ worldFamily: family });

  useEffect(() => {
    let mounted = true;
    // The route path already names the family, so the renderer chunk can travel
    // alongside the share request rather than after it. Share pages are the
    // cold-cache case that matters most: a visitor arrives from a link.
    prefetchSceneRendererForFamily(family);
    api
      .getShareWorld(shareSlug, family)
      .then((nextWorld) => mounted && setWorld(nextWorld))
      .catch((err) => mounted && setError(apiErrorMessage(err)))
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, [family, shareSlug]);

  const scene = useMemo(() => sceneFromVariant(world?.variant), [world]);
  const planets = useMemo(() => pointsOfInterestFromScene(scene), [scene]);

  useEffect(() => {
    setSelectedPlanetKey(null);
  }, [world]);

  function handleSelectPlanet(planet: PlanetSceneConfig | null) {
    if (!planet) {
      setSelectedPlanetKey(null);
      return;
    }
    const planetIndex = planets.indexOf(planet);
    setSelectedPlanetKey(planetIdentityKey(planet, planetIndex));
  }

  if (loading) {
    return (
      <main className="mx-auto grid min-h-screen w-full max-w-7xl place-items-center px-4 pb-footer-height pt-header-height">
        <StatusMessage tone="loading">Loading shared world...</StatusMessage>
      </main>
    );
  }

  if (!world) {
    return (
      <main className="mx-auto grid min-h-screen w-full max-w-7xl place-items-center px-4 pb-footer-height pt-header-height">
        <StatusMessage tone="error">{error || "Shared world not found"}</StatusMessage>
      </main>
    );
  }

  return (
    <main
      className={`relative flex min-h-screen flex-col lg:block lg:h-screen lg:overflow-hidden ${
        isForestScene(scene) ? "forest-chrome" : ""
      }`}
    >
      {/* Clears every HUD island off the world and brings them back. Outside the
          collapsing region, so it can never hide itself. */}
      <WorldChromeToggle
        isExpanded={collapseState.isExpanded}
        onToggle={toggleCollapse}
        controlsElementId={WORLD_PANELS_ELEMENT_ID}
        noun="panels"
        buttonReference={toggleButtonReference}
      />

      {/* Full-bleed universe: an in-flow hero on mobile, the immersive background
          on desktop. Clicking a planet focuses the camera (read-only view state).
          On mobile the hero takes the whole viewport once the panels are gone. */}
      <div
        className={`relative w-full lg:absolute lg:inset-0 lg:h-full ${
          collapseState.reservesLayoutSpace ? "h-[48vh]" : "h-svh"
        }`}
      >
        <UniverseCanvas
          scene={scene}
          className="h-full"
          selectedPlanetKey={selectedPlanetKey}
          onSelectPlanet={handleSelectPlanet}
          enableAmbientSound
        />
      </div>

      {/* HUD overlay — a scrolling column on mobile; on desktop a pointer-through
          layer so orbit-drag passes between the floating glass islands. Also the
          single collapse target: it fades rather than sliding, because its
          islands are anchored to both edges and the bottom centre. */}
      <div
        id={WORLD_PANELS_ELEMENT_ID}
        className={`immersive-exit relative z-10 flex flex-col gap-4 p-4 sm:p-6 lg:pointer-events-none lg:absolute lg:inset-x-0 lg:bottom-[57px] lg:top-[57px] ${
          collapseState.reservesLayoutSpace
            ? // Same footer clearance as the world page: in flow below lg, the
              // fixed footer sits over whatever this column ends with.
              "flex-1 pb-[calc(var(--footer-height)+1rem)] lg:pb-0"
            : "h-0 overflow-hidden p-0 sm:p-0"
        }`}
      >
        {/* `min-h-0` for the same reason as the world page: without it this row
            keeps its content height, overflows the box that top/bottom fixed,
            and pushes whatever follows over the footer. */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          {/* Left island: identity */}
          <div className="pointer-events-auto flex w-full flex-col gap-4 lg:max-h-full lg:w-[340px] lg:min-h-0 lg:overflow-y-auto">
            <div className="glass-panel glass-panel-glow rounded-2xl p-5">
              {world.archetype ? (
                <p className="mb-1 font-mono text-xs uppercase tracking-[0.2em] text-brass">{world.archetype}</p>
              ) : null}
              <RareFeatureBadge scene={scene} />
              <h1 className="font-display text-2xl font-semibold tracking-normal text-paper">
                {world.title || (isForestScene(scene) ? "Shared forest" : "Shared universe")}
              </h1>
              {world.nickname ? (
                <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-grey">
                  A portrait of {world.nickname}
                </p>
              ) : null}
              {planets.length ? (
                // Engraved accession placard — the world's identity as curatorial
                // wall-text, in place of the old fake "Signature" tag.
                <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-brass">
                  Curated from {planets.slice(0, 3).map((planet) => planet.name).filter(Boolean).join(" · ")}
                </p>
              ) : null}
              {world.quote ? (
                <p className="mt-2 text-sm italic leading-6 text-on-surface">&ldquo;{world.quote}&rdquo;</p>
              ) : null}
              {world.summary ? <p className="mt-2 text-sm leading-6 text-on-surface-variant">{world.summary}</p> : null}
            </div>
          </div>

          {/* Right island: World DNA (planets) */}
          <div className="pointer-events-auto flex w-full flex-col gap-4 lg:max-h-full lg:w-[340px] lg:min-h-0 lg:overflow-y-auto">
            <PlanetDetailsPanel
              planets={planets}
              selectedPlanetKey={selectedPlanetKey}
              onSelectPlanet={handleSelectPlanet}
            />
          </div>
        </div>

        {/* Bottom-center conversion CTA */}
        <div className="pointer-events-auto mx-auto text-center">
          <Link
            href="/"
            className="focus-ring btn-gradient inline-flex items-center gap-2 rounded-full px-7 py-3.5 font-semibold"
          >
            {isForestScene(scene) ? "Create Your Own Forest" : "Create Your Own Universe"}
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </main>
  );
}
