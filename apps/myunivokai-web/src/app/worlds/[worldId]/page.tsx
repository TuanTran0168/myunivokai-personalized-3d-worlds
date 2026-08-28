"use client";

import Link from "next/link";
import { Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Copy, Download, ExternalLink, Loader2, RefreshCw, Rocket } from "lucide-react";
import { toast } from "sonner";
import { api, apiErrorMessage } from "@/lib/api";
import { exportSceneCanvasAsPng } from "@/lib/exportImage";
import { addWorldIdentifierToGallery, recordLastViewedWorld } from "@/lib/savedWorlds";
import { isForestScene, pointsOfInterestFromScene, sceneFromVariant, selectedVariant } from "@/lib/scene";
import { sharePagePath, worldFamilyFromQueryValue, WORLD_FAMILY_QUERY_PARAMETER } from "@/lib/worldRoutes";
import type { PlanetSceneConfig, World, WorldFamily, WorldVariant } from "@/lib/types";
import { StatusMessage } from "@/components/StatusMessage";
import { PlanetDetailsPanel } from "@/components/PlanetDetailsPanel";
import { RareFeatureBadge } from "@/components/RareFeatureBadge";
import { UniverseCanvas } from "@/components/UniverseCanvas";
import { planetIdentityKey } from "@/features/scene-renderers/planetIdentity";
import { prefetchSceneRendererForFamily } from "@/features/scene-renderers/registry";
import { VariantList } from "@/components/VariantList";
import { useWorldChromeCollapse, WorldChromeToggle } from "@/components/WorldChromeToggle";
import { WORLD_PANELS_ELEMENT_ID } from "@/lib/formRailCollapse";

// `params` is a Promise from Next 15 onward. This file is "use client", so it
// cannot await — React's `use` is the documented equivalent, and it works on 14
// as well, which is why this lands ahead of the version bump. See
// notes/vision/frontend-modernization-research.md#the-exact-code-change-all-three-files.
type PageProps = {
  params: Promise<{
    worldId: string;
  }>;
};

// useSearchParams requires a Suspense boundary during prerendering; the
// wrapper reads ?family=nature (nature-service worlds) and hands the resolved
// family to the actual page.
export default function WorldPage({ params }: PageProps) {
  const { worldId } = use(params);
  return (
    <Suspense
      fallback={
        <main className="mx-auto grid min-h-screen w-full max-w-7xl place-items-center px-4 pb-[57px] pt-[57px]">
          <StatusMessage tone="loading">Loading world...</StatusMessage>
        </main>
      }
    >
      <WorldPageWithFamily worldId={worldId} />
    </Suspense>
  );
}

function WorldPageWithFamily({ worldId }: { worldId: string }) {
  const searchParams = useSearchParams();
  const family = worldFamilyFromQueryValue(searchParams.get(WORLD_FAMILY_QUERY_PARAMETER));
  return <WorldPageContent worldId={worldId} family={family} />;
}

function WorldPageContent({ worldId, family }: { worldId: string; family: WorldFamily }) {
  const [world, setWorld] = useState<World | null>(null);
  const [activeVariantId, setActiveVariantId] = useState<string>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<"variant" | "publish" | "select" | "copy" | null>(null);
  const [selectedPlanetKey, setSelectedPlanetKey] = useState<string | null>(null);
  // No errorMessage: this page reports failures as toasts, which sit outside the
  // collapsing region, so hiding the panels can never swallow one.
  const { collapseState, toggleCollapse, toggleButtonReference } = useWorldChromeCollapse({ worldFamily: family });
  const sceneContainerReference = useRef<HTMLDivElement>(null);

  async function loadWorld() {
    setError("");
    const nextWorld = await api.getWorld(worldId, family);
    setWorld(nextWorld);
    const active = selectedVariant(nextWorld);
    setActiveVariantId((current) => current || active?.id);
  }

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    // Start the renderer chunk now instead of when the response lands: `?family=`
    // already says which one, so the two requests overlap rather than queue.
    prefetchSceneRendererForFamily(family);
    api
      .getWorld(worldId, family)
      .then((nextWorld) => {
        if (!mounted) {
          return;
        }
        setWorld(nextWorld);
        setActiveVariantId(selectedVariant(nextWorld)?.id);
        addWorldIdentifierToGallery(nextWorld.id, family);
        // Unconditional, unlike the add above: this is the one signal the
        // gallery's ambient backdrop uses to know which world the visitor
        // last had open, and a re-view has to update it every time.
        recordLastViewedWorld(nextWorld.id, family);
      })
      .catch((err) => mounted && setError(apiErrorMessage(err)))
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, [family, worldId]);

  const activeVariant = useMemo(() => {
    if (!world) {
      return undefined;
    }
    return world.variants.find((variant) => variant.id === activeVariantId) ?? selectedVariant(world);
  }, [activeVariantId, world]);

  const activeScene = useMemo(() => sceneFromVariant(activeVariant), [activeVariant]);
  // Planets for universe worlds, landmarks for forest worlds — the details
  // panel, selection and camera focus all run off the same adapter.
  const activeScenePlanets = useMemo(() => pointsOfInterestFromScene(activeScene), [activeScene]);

  useEffect(() => {
    setSelectedPlanetKey(null);
  }, [activeVariantId]);

  function handleSelectPlanet(planet: PlanetSceneConfig | null) {
    if (!planet) {
      setSelectedPlanetKey(null);
      return;
    }
    const planetIndex = activeScenePlanets.indexOf(planet);
    setSelectedPlanetKey(planetIdentityKey(planet, planetIndex));
  }

  async function regenerateVariant() {
    setAction("variant");
    try {
      const variant = await api.regenerateVariant(worldId, family);
      await loadWorld();
      setActiveVariantId(variant.id);
      toast.success("Variant created.");
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setAction(null);
    }
  }

  async function selectCurrentVariant(variant: WorldVariant) {
    setAction("select");
    setActiveVariantId(variant.id);
    try {
      await api.selectVariant(worldId, variant.id, family);
      await loadWorld();
      toast.success("Variant selected.");
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setAction(null);
    }
  }

  async function publishWorld() {
    setAction("publish");
    try {
      await api.publishWorld(worldId, family);
      // Publish returns only the share slug, not a full world. Re-fetch so the
      // world keeps its variants/planets (otherwise the canvas falls back to the
      // abstract renderer) and picks up the new shareSlug.
      await loadWorld();
      toast.success("World published.");
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setAction(null);
    }
  }

  function exportSceneImage() {
    const exportFileName = `myunivokai-${activeScene.sceneName ?? world?.id ?? "universe"}`;
    const exportSucceeded = exportSceneCanvasAsPng(sceneContainerReference.current, exportFileName);
    if (exportSucceeded) {
      toast.success("Image exported.");
    } else {
      toast.error("Could not export image.");
    }
  }

  async function copyShareLink() {
    if (!world?.shareSlug) {
      return;
    }
    setAction("copy");
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${sharePagePath(world.shareSlug, family)}`);
      toast.success("Share link copied.");
    } catch {
      toast("Share link ready.");
    } finally {
      setAction(null);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto grid min-h-screen w-full max-w-7xl place-items-center px-4 pb-[57px] pt-[57px]">
        <StatusMessage tone="loading">Loading world...</StatusMessage>
      </main>
    );
  }

  if (!world) {
    return (
      <main className="mx-auto grid min-h-screen w-full max-w-7xl place-items-center px-4 pb-[57px] pt-[57px]">
        <StatusMessage tone="error">{error || "World not found"}</StatusMessage>
      </main>
    );
  }

  return (
    <main
      className={`relative flex min-h-screen flex-col lg:block lg:h-screen lg:overflow-hidden ${
        isForestScene(activeScene) ? "forest-chrome" : ""
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

      {/* Full-bleed solar system: an in-flow hero on mobile, the command-deck
          background on desktop (bleeds behind the glass header). The ref wraps
          the canvas so Export captures it. On mobile the hero takes the whole
          viewport once the panels are gone and their box has been released. */}
      <div
        ref={sceneContainerReference}
        className={`relative w-full lg:absolute lg:inset-0 lg:h-full ${
          collapseState.reservesLayoutSpace ? "h-[48vh]" : "h-svh"
        }`}
      >
        <UniverseCanvas
          scene={activeScene}
          className="h-full"
          selectedPlanetKey={selectedPlanetKey}
          onSelectPlanet={handleSelectPlanet}
          preserveDrawingBuffer
          enableAmbientSound
        />
      </div>

      {/* HUD overlay — a normal scrolling column on mobile; on desktop it becomes
          a pointer-transparent layer so orbit-drag passes through the gaps, while
          each glass island re-enables pointer events.

          This is also the single collapse target. It leaves by fading rather than
          sliding, because its islands are anchored to both edges and the bottom
          centre — a single direction would drag one of them across the whole
          screen. `.immersive-exit` keys off the same <body> marker that clears
          the header and footer, so all of it goes at once. It carries neither
          .glass-panel nor .glass-rise, so it needs no wrapper of its own. */}
      <div
        id={WORLD_PANELS_ELEMENT_ID}
        className={`immersive-exit relative z-10 flex flex-col gap-4 p-4 sm:p-6 lg:pointer-events-none lg:absolute lg:inset-x-0 lg:bottom-[57px] lg:top-[57px] ${
          collapseState.reservesLayoutSpace
            ? // Below lg this column is in flow and the footer is fixed over it, so
              // the bottom action toolbar ended up underneath the footer bar. The
              // desktop branch already reserves the same height with lg:bottom.
              "flex-1 pb-[calc(var(--footer-height)+1rem)] lg:pb-0"
            : "h-0 overflow-hidden p-0 sm:p-0"
        }`}
      >
        {/* `lg:min-h-0` is what keeps the action toolbar below off the footer.
            This row is a flex item in a column whose height is fixed by
            top/bottom above, and a column flex item defaults to
            `min-height: auto` — it refuses to shrink below its content. Tall
            islands therefore pushed the toolbar out of the bottom of the box
            and straight over the footer's centre text. The islands' own
            `lg:max-h-full` could not save it either: a percentage max-height
            resolves to `none` against an indefinite height, so their
            `overflow-y-auto` never engaged. With `min-h-0` the row shrinks to
            the height flex actually assigns it, `max-h-full` resolves, and the
            islands scroll inside instead of growing. */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          {/* Left island: identity + variants */}
          <div className="pointer-events-auto flex w-full flex-col gap-4 lg:max-h-full lg:w-[320px] lg:min-h-0 lg:overflow-y-auto">
            <div className="glass-panel glass-panel-glow glass-rise rounded-2xl p-5">
              {activeScene.archetype ? (
                <p className="mb-1 font-mono text-xs uppercase tracking-[0.2em] text-brass">{activeScene.archetype}</p>
              ) : null}
              <RareFeatureBadge scene={activeScene} />
              <h1 className="font-display text-2xl font-semibold tracking-normal text-paper">
                {activeScene.sceneName || world.title || (isForestScene(activeScene) ? "Untitled forest" : "Untitled universe")}
              </h1>
              {world.nickname ? (
                <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-grey">
                  A portrait of {world.nickname}
                </p>
              ) : null}
              {activeScene.quote ? (
                <p className="mt-2 text-sm italic leading-6 text-on-surface">&ldquo;{activeScene.quote}&rdquo;</p>
              ) : null}
              {world.summary ? <p className="mt-2 text-sm leading-6 text-on-surface-variant">{world.summary}</p> : null}
            </div>

            <div className="glass-panel rounded-2xl p-4">
              <h2 className="mb-3 font-display text-base font-semibold text-on-surface">Variants</h2>
              {world.variants.length ? (
                <VariantList
                  world={world}
                  activeVariantId={activeVariant?.id}
                  busyVariantId={action === "select" ? activeVariant?.id : undefined}
                  onSelect={selectCurrentVariant}
                />
              ) : (
                <p className="text-sm text-on-surface-variant">No variants yet.</p>
              )}
            </div>
          </div>

          {/* Right island: World DNA (planets) + share */}
          <div className="pointer-events-auto flex w-full flex-col gap-4 lg:max-h-full lg:w-[340px] lg:min-h-0 lg:overflow-y-auto">
            <PlanetDetailsPanel
              planets={activeScenePlanets}
              selectedPlanetKey={selectedPlanetKey}
              onSelectPlanet={handleSelectPlanet}
            />
            {world.shareSlug ? (
              <div className="glass-panel rounded-2xl p-4">
                <h2 className="mb-3 font-display text-base font-semibold text-on-surface">Share</h2>
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md border border-hairline bg-black/30 p-2">
                  <span className="truncate text-sm text-on-surface-variant">{sharePagePath(world.shareSlug, family)}</span>
                  <button
                    type="button"
                    title="Copy link"
                    aria-label="Copy share link"
                    onClick={copyShareLink}
                    className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md border border-hairline bg-black/30 text-on-surface"
                  >
                    {action === "copy" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                  </button>
                  <Link
                    href={sharePagePath(world.shareSlug, family)}
                    title="Open share page"
                    aria-label="Open share page"
                    className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md border border-hairline bg-black/30 text-on-surface"
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Bottom-center action toolbar */}
        <div className="pointer-events-auto mx-auto">
          <div className="glass-panel glass-panel-glow glass-rise flex flex-wrap items-center justify-center gap-2 rounded-2xl p-2">
            <button
              type="button"
              onClick={regenerateVariant}
              disabled={action !== null}
              className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-xl border border-hairline bg-black/30 px-4 py-2 text-sm text-on-surface tappable hover:border-white/25 disabled:opacity-45"
            >
              {action === "variant" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
              Regenerate Variant
            </button>
            <button
              type="button"
              onClick={exportSceneImage}
              className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-xl border border-hairline bg-black/30 px-4 py-2 text-sm text-on-surface tappable hover:border-white/25"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Export Image
            </button>
            <button
              type="button"
              onClick={publishWorld}
              disabled={action !== null}
              className="focus-ring btn-gradient inline-flex min-h-10 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-45"
            >
              {action === "publish" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Rocket className="h-4 w-4" aria-hidden="true" />}
              {world.shareSlug ? "Re-publish" : "Publish"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
