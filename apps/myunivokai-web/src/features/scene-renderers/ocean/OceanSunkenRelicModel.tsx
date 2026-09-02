"use client";

import { useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { Box3, Color, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { applyCaustics, type CausticsUniforms } from "./oceanCaustics";
import { LANDMARK_HEIGHT_METRES } from "./oceanLandmarkGeometry";

/**
 * The one loaded prop on this family's seabed, and the one place a downloaded
 * model earns its bytes.
 *
 * Everything else standing on the sand is procedural, on purpose: a boulder, a
 * coral head or a vent chimney is irregular in ways a seeded generator is good
 * at, and a fixed mesh would repeat visibly across worlds. A wreck is the
 * opposite. Its realism is man-made detail — plate seams, rivet lines, a
 * companionway — and a generator that has to invent those produces architecture
 * with no history in it.
 *
 * `Stern Of SS Rifle`, a Scottish Maritime Museum photoscan of a real
 * pre-fabricated screw steamer, is the ONLY CC0 wreck on Sketchfab; see
 * `agent-system/evolution/ocean-seabed-props-research.md` for the whole
 * catalogue and why every cheap alternative is somebody else's procedural guess
 * with a licence obligation attached. CC0 means no attribution requirement and
 * no redistribution problem, which is why this file can exist at all.
 *
 * It arrives here at 11 k triangles and 609 KB, down from 250 k and 14.5 MB —
 * `scripts/fetch-ocean-wreck.mjs` is the pipeline, and it is committed so the
 * next person does not have to rediscover it. What survives that decimation is
 * the silhouette and the baked albedo, which is exactly the man-made detail the
 * geometry could never have carried at this budget anyway.
 *
 * SHOWN ONLY WHEN THE RARITY LOTTERY HITS. The backend emits `sunkenRelic` as
 * an ordinary non-hero landmark kind, so wiring the model to the kind would put
 * 609 KB into a large share of worlds; `buildSunkenRelic` stays the ordinary
 * case and is also this component's Suspense fallback, so a slow download is a
 * procedural wreck rather than a hole in the seabed.
 */
const SUNKEN_RELIC_MODEL_PATH = "/assets/ocean/models/prop-shipwreck-stern.glb";

/**
 * The scan is a 3.2 x 3.2 x 7.5 m stern section. Scaled to the same height the
 * procedural relic stands at, so the lottery does not change how big a wreck is
 * — only how much of one there is to look at.
 */
const RELIC_TARGET_HEIGHT_METRES = LANDMARK_HEIGHT_METRES.sunkenRelic;

/**
 * Steel that has been on a seabed is not the colour of steel. The scan was lit
 * and photographed in a museum, so its albedo carries dry daylight; this pulls
 * it toward the water it is now under, the same way `LANDMARK_BASE_COLORS` are
 * pulled for every procedural formation.
 */
const RELIC_SUBMERGED_ALBEDO = new Color("#8E9AA0");
const RELIC_WATER_TINT_FLOOR = 0.25;

type OceanSunkenRelicModelProps = {
  /** Shared with the seabed, so the wreck catches the same wave the sand does. */
  causticsUniforms: CausticsUniforms;
  /** The world's fog colour, which is what the water takes the albedo toward. */
  fogColor: string;
  tintStrength: number;
};

export function OceanSunkenRelicModel({
  causticsUniforms,
  fogColor,
  tintStrength
}: OceanSunkenRelicModelProps) {
  const { scene } = useGLTF(SUNKEN_RELIC_MODEL_PATH);

  const relic = useMemo(() => {
    const model = scene.clone(true);
    model.updateMatrixWorld(true);

    // Scale FIRST, then ground: the offset that puts the foot on the sand is a
    // property of the scaled model, and applying it the other way round buries
    // the wreck by whatever the scale factor happens to be.
    const rawBounds = new Box3().setFromObject(model);
    const rawSize = rawBounds.getSize(new Vector3());
    const scale = RELIC_TARGET_HEIGHT_METRES / Math.max(rawSize.y, 0.001);
    model.scale.setScalar(scale);
    model.updateMatrixWorld(true);

    // The contract every seabed prop is placed by: foot at y = 0, centred on
    // its own footprint. `lowestSeafloorUnderFootprint` puts the group where
    // the sand is, and anything that ignores this floats or is buried.
    const scaledBounds = new Box3().setFromObject(model);
    const centre = scaledBounds.getCenter(new Vector3());
    model.position.set(-centre.x, -scaledBounds.min.y, -centre.z);

    const materials: MeshStandardMaterial[] = [];
    model.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) {
        return;
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (!(source instanceof MeshStandardMaterial)) {
        return;
      }
      // Cloned because the loader caches the GLTF: patching the shared material
      // in place would put one world's caustics and one world's fog on every
      // other world that ever loads this model.
      const dressed = source.clone();
      dressed.color
        .copy(RELIC_SUBMERGED_ALBEDO)
        .lerp(new Color(fogColor), Math.max(RELIC_WATER_TINT_FLOOR, tintStrength));
      applyCaustics(dressed, causticsUniforms);
      mesh.material = dressed;
      materials.push(dressed);
    });
    return { model, materials };
  }, [scene, causticsUniforms, fogColor, tintStrength]);

  useEffect(
    () => () => {
      for (const material of relic.materials) {
        material.dispose();
      }
    },
    [relic]
  );

  return <primitive object={relic.model} />;
}
