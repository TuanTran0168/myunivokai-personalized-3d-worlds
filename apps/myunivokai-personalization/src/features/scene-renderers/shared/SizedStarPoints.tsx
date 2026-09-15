"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending } from "three";
import {
  buildStarPointsNodeLayer,
  starPointsFragmentShaderGlsl,
  STAR_POINTS_VERTEX_SHADER,
  type StarLayerAttributes
} from "./sizedStarPointsMaterial";
import { useNodeMaterialModules } from "./useNodeMaterialModules";

/**
 * Star points with a PER-STAR size, color and twinkle phase. three's stock
 * PointsMaterial gives every point in a layer the same size, which is what
 * made the sky read as uniform "confetti"; a real starfield follows a power
 * law — thousands of faint pinpricks and only a handful of bright glows.
 * The fragment shader draws each star as a hot compact core plus a wide
 * faint halo (the way stars bloom in long-exposure photographs) and
 * modulates it with a slow twinkle.
 *
 * Colors are passed as RAW sRGB values and written to the framebuffer
 * unconverted (a raw ShaderMaterial skips three's color-space and
 * tone-mapping chunks), so the authored hex palette is exactly what shows
 * on screen.
 *
 * **TWO IMPLEMENTATIONS, AND THEY ARE DIFFERENT OBJECTS RATHER THAN DIFFERENT
 * MATERIALS.** This is the first port in §26 Phases 6-8 where the dual path
 * changes the scene graph and not just the shader, because WebGPU has no point
 * size at all: a sized star has to be a QUAD there. So the classic path stays a
 * `Points` with a `ShaderMaterial`, and the node path is an instanced `Sprite`
 * whose quad three expands to the same pixel size. Both are built from one set
 * of constants in `sizedStarPointsMaterial.ts`; see that file for why the two
 * sizing expressions are the same expression.
 */

export type { StarLayerAttributes };

type SizedStarPointsProps = {
  stars: StarLayerAttributes;
  globalOpacity?: number;
  /** 0 = plain stars; 1 = full diffraction spikes (hero-star layers only). */
  spikeStrength?: number;
  renderOrder?: number;
  /** Forces the buffer geometry to remount when the star arrays change. */
  geometryKey?: string;
};

const DEFAULT_GLOBAL_OPACITY = 1;
const DEFAULT_SPIKE_STRENGTH = 0;
const DEFAULT_RENDER_ORDER = 0;
const HALF = 2;

/**
 * Parses a #RRGGBB hex color into raw sRGB unit components, bypassing
 * three's Color class on purpose: Color converts hex to the linear working
 * space, but this shader writes colors to the framebuffer unconverted.
 */
export function hexColorToUnitRgb(hexColor: string): [number, number, number] {
  const parsedColor = Number.parseInt(hexColor.slice(1), 16);
  return [
    ((parsedColor >> 16) & 0xff) / 255,
    ((parsedColor >> 8) & 0xff) / 255,
    (parsedColor & 0xff) / 255
  ];
}

/**
 * The node path: one instanced `Sprite` quad per star.
 *
 * `count` is `Sprite`'s own instancing field and three's docs say plainly it
 * "can only be used with WebGPURenderer" — which is exactly the renderer this
 * branch runs under.
 *
 * **`geometryKey` IS NOT USED HERE AND DOES NOT NEED TO BE.** It exists to force
 * fiber to remount the classic path's declarative `<bufferGeometry>` when the
 * arrays behind it change. This branch builds its geometry and material
 * imperatively from `stars`, and every caller memoises that object on the inputs
 * that produced it, so a changed layer is a changed reference and the `useMemo`
 * below rebuilds on its own.
 */
function NodeStarSprites({
  stars,
  globalOpacity,
  spikeStrength,
  renderOrder,
  modules
}: Required<Pick<SizedStarPointsProps, "stars" | "globalOpacity" | "spikeStrength" | "renderOrder">> & {
  modules: ReturnType<typeof useNodeMaterialModules> & object;
}) {
  const layer = useMemo(
    () => buildStarPointsNodeLayer(modules, stars, spikeStrength),
    [modules, spikeStrength, stars]
  );

  // A node material and its geometry are constructed here rather than by fiber,
  // so nothing else will dispose them.
  useEffect(() => {
    return () => {
      layer.material.dispose();
      layer.geometry.dispose();
    };
  }, [layer]);

  useFrame((state) => {
    layer.uniforms.timeSeconds.value = state.clock.elapsedTime;
    layer.uniforms.globalOpacity.value = globalOpacity;
    layer.uniforms.spikeStrength.value = spikeStrength;
  });

  return (
    <sprite
      frustumCulled={false}
      renderOrder={renderOrder}
      count={layer.instanceCount}
      geometry={layer.geometry}
      material={layer.material}
    />
  );
}

/** The classic path: a `Points` with a raw GLSL `ShaderMaterial`. */
function ClassicStarPoints({
  stars,
  globalOpacity,
  spikeStrength,
  renderOrder,
  geometryKey
}: Required<Pick<SizedStarPointsProps, "stars" | "globalOpacity" | "spikeStrength" | "renderOrder">> &
  Pick<SizedStarPointsProps, "geometryKey">) {
  // Created once; useFrame keeps the values current without rebuilding the
  // material (a new uniforms object would recompile the shader program).
  const uniforms = useMemo(
    () => ({
      uPointScale: { value: 1 },
      uTimeSeconds: { value: 0 },
      uGlobalOpacity: { value: DEFAULT_GLOBAL_OPACITY },
      uSpikeStrength: { value: DEFAULT_SPIKE_STRENGTH }
    }),
    []
  );
  const fragmentShader = useMemo(() => starPointsFragmentShaderGlsl(), []);

  useFrame((state) => {
    // Matches PointsMaterial's sizeAttenuation convention (half the drawing
    // buffer height), so star sizes stay consistent across window sizes and
    // device pixel ratios. three's node sprite path computes the same product
    // from `screenDPR` and half the canvas height in logical units.
    uniforms.uPointScale.value = (state.size.height * state.gl.getPixelRatio()) / HALF;
    uniforms.uTimeSeconds.value = state.clock.elapsedTime;
    uniforms.uGlobalOpacity.value = globalOpacity;
    uniforms.uSpikeStrength.value = spikeStrength;
  });

  return (
    <points frustumCulled={false} renderOrder={renderOrder}>
      {/* `args` rather than array/itemSize/count as separate props. Under R3F v9
          these are constructor arguments — `new BufferAttribute(array, itemSize)`
          — and `count` is derived from them, so passing the three as props left
          the attribute constructed with no data at all. v8 tolerated it; v9's
          types are what caught it. */}
      <bufferGeometry key={geometryKey}>
        <bufferAttribute attach="attributes-position" args={[stars.positions, 3]} />
        <bufferAttribute attach="attributes-starColor" args={[stars.colors, 3]} />
        <bufferAttribute attach="attributes-starSize" args={[stars.sizes, 1]} />
        <bufferAttribute attach="attributes-twinklePhase" args={[stars.twinklePhases, 1]} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={STAR_POINTS_VERTEX_SHADER}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}

export function SizedStarPoints({
  stars,
  globalOpacity = DEFAULT_GLOBAL_OPACITY,
  spikeStrength = DEFAULT_SPIKE_STRENGTH,
  renderOrder = DEFAULT_RENDER_ORDER,
  geometryKey
}: SizedStarPointsProps) {
  const nodeModules = useNodeMaterialModules();

  if (nodeModules) {
    return (
      <NodeStarSprites
        stars={stars}
        globalOpacity={globalOpacity}
        spikeStrength={spikeStrength}
        renderOrder={renderOrder}
        modules={nodeModules}
      />
    );
  }

  return (
    <ClassicStarPoints
      stars={stars}
      globalOpacity={globalOpacity}
      spikeStrength={spikeStrength}
      renderOrder={renderOrder}
      geometryKey={geometryKey}
    />
  );
}
