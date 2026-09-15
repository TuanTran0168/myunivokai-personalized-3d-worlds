"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import type { Blending, Texture } from "three";
import {
  getNebulaCloudAtlasTexture,
  NEBULA_CLOUD_ATLAS_VARIANT_COUNT
} from "../shared/nebulaCloudTexture";
import { useNodeMaterialModules } from "../shared/useNodeMaterialModules";
import {
  buildCloudPointsNodeLayer,
  cloudPointsFragmentShaderGlsl,
  CLOUD_POINTS_VERTEX_SHADER,
  type CloudLayerAttributes
} from "./nebulaCloudPointsMaterial";

/**
 * A layer of large, faint, individually-rotated cloud sprites sampling one of
 * the atlas's noise variants. Realistic nebulosity comes from overdraw
 * statistics, not individual sprite quality: MANY sprites at very low alpha
 * fuse into continuous wisps, while high-alpha sprites read as separate
 * "puffs". With additive blending the layer glows (nebula, galactic core);
 * with normal blending and dark colors it darkens what is behind it (the
 * Great Rift's dust).
 *
 * Two implementations, and they are different OBJECTS rather than different
 * materials — a `Points` on the classic path, an instanced `Sprite` on the node
 * one, because WebGPU has no point size. See `nebulaCloudPointsMaterial.ts`,
 * and `shared/sizedStarPointsMaterial.ts` for why the two sizing expressions
 * are the same expression.
 */

export type { CloudLayerAttributes };

type NebulaCloudPointsProps = {
  clouds: CloudLayerAttributes;
  globalOpacity: number;
  blending: Blending;
  renderOrder?: number;
  /** Forces the buffer geometry to remount when the cloud arrays change. */
  geometryKey?: string;
};

const DEFAULT_RENDER_ORDER = 0;
const HALF = 2;

function NodeCloudSprites({
  clouds,
  globalOpacity,
  blending,
  renderOrder,
  atlasTexture,
  modules
}: Required<Pick<NebulaCloudPointsProps, "clouds" | "globalOpacity" | "blending" | "renderOrder">> & {
  atlasTexture: Texture;
  modules: NonNullable<ReturnType<typeof useNodeMaterialModules>>;
}) {
  const layer = useMemo(
    () => buildCloudPointsNodeLayer(modules, clouds, blending, atlasTexture),
    [atlasTexture, blending, clouds, modules]
  );

  // Constructed here rather than by fiber, so nothing else will dispose them.
  useEffect(() => {
    return () => {
      layer.material.dispose();
      layer.geometry.dispose();
    };
  }, [layer]);

  useFrame(() => {
    layer.uniforms.globalOpacity.value = globalOpacity;
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

function ClassicCloudPoints({
  clouds,
  globalOpacity,
  blending,
  renderOrder,
  geometryKey
}: Required<Pick<NebulaCloudPointsProps, "clouds" | "globalOpacity" | "blending" | "renderOrder">> &
  Pick<NebulaCloudPointsProps, "geometryKey">) {
  // Created once; useFrame keeps the values current without rebuilding the
  // material (a new uniforms object would recompile the shader program).
  const uniforms = useMemo(
    () => ({
      uCloudMap: { value: getNebulaCloudAtlasTexture() },
      uAtlasVariantCount: { value: NEBULA_CLOUD_ATLAS_VARIANT_COUNT },
      uPointScale: { value: 1 },
      uGlobalOpacity: { value: 0 }
    }),
    []
  );
  const fragmentShader = useMemo(() => cloudPointsFragmentShaderGlsl(), []);

  useFrame((state) => {
    // Same sizeAttenuation convention as the star layers, so cloud sizes are
    // stable across window sizes and device pixel ratios.
    uniforms.uPointScale.value = (state.size.height * state.gl.getPixelRatio()) / HALF;
    uniforms.uGlobalOpacity.value = globalOpacity;
  });

  return (
    <points frustumCulled={false} renderOrder={renderOrder}>
      <bufferGeometry key={geometryKey}>
        <bufferAttribute attach="attributes-position" args={[clouds.positions, 3]} />
        <bufferAttribute attach="attributes-cloudColor" args={[clouds.colors, 3]} />
        <bufferAttribute attach="attributes-cloudSize" args={[clouds.sizes, 1]} />
        <bufferAttribute attach="attributes-cloudRotation" args={[clouds.rotations, 1]} />
        <bufferAttribute attach="attributes-cloudAlpha" args={[clouds.alphas, 1]} />
        <bufferAttribute attach="attributes-cloudVariant" args={[clouds.variants, 1]} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={CLOUD_POINTS_VERTEX_SHADER}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={blending}
      />
    </points>
  );
}

export function NebulaCloudPoints({
  clouds,
  globalOpacity,
  blending,
  renderOrder = DEFAULT_RENDER_ORDER,
  geometryKey
}: NebulaCloudPointsProps) {
  const nodeModules = useNodeMaterialModules();
  const atlasTexture = useMemo(() => getNebulaCloudAtlasTexture(), []);

  // A null atlas means no `document` — the texture is painted on a canvas — and
  // a node graph cannot sample null. The classic path passes the same null into
  // a uniform and draws nothing, which is the same outcome by a different route.
  if (nodeModules && atlasTexture) {
    return (
      <NodeCloudSprites
        clouds={clouds}
        globalOpacity={globalOpacity}
        blending={blending}
        renderOrder={renderOrder}
        atlasTexture={atlasTexture}
        modules={nodeModules}
      />
    );
  }

  return (
    <ClassicCloudPoints
      clouds={clouds}
      globalOpacity={globalOpacity}
      blending={blending}
      renderOrder={renderOrder}
      geometryKey={geometryKey}
    />
  );
}
