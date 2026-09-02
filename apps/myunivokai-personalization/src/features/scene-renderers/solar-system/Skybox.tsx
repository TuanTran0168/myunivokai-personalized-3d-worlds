"use client";

import { useMemo } from "react";
import { useLoader, useThree } from "@react-three/fiber";
import { BackSide, Color, TextureLoader } from "three";
import { applyColorTextureQuality } from "../shared/textureQuality";
import { MILKY_WAY_SKYBOX_TEXTURE_URL } from "./planetTextureCatalog";

const SKYBOX_RADIUS = 60;
// The Solar System Scope panorama is a real photo but exposed very dark; a
// >1 color multiplier (legal on meshBasicMaterial with toneMapped=false)
// brings the band and its dust lanes up to naked-eye-photo brightness.
// Retuned from 2.2 after the sRGB colorSpace fix (the old value compensated
// for the double-gamma of an untagged texture).
const SKYBOX_BRIGHTNESS_MULTIPLIER = 3.0;

export function Skybox() {
  const gl = useThree((state) => state.gl);
  const milkyWayTexture = useLoader(TextureLoader, MILKY_WAY_SKYBOX_TEXTURE_URL);
  useMemo(() => applyColorTextureQuality(milkyWayTexture, gl), [milkyWayTexture, gl]);
  const brightnessTint = useMemo(
    () => new Color(SKYBOX_BRIGHTNESS_MULTIPLIER, SKYBOX_BRIGHTNESS_MULTIPLIER, SKYBOX_BRIGHTNESS_MULTIPLIER),
    []
  );

  return (
    <mesh>
      <sphereGeometry args={[SKYBOX_RADIUS, 64, 48]} />
      {/* Opaque + depthWrite=false: as a transparent material the skybox was
          distance-sorted against the star/constellation point layers, and the
          flipping draw order made them blink while orbiting. Opaque renders
          first, always behind everything. toneMapped=false: ACES tone mapping
          crushes the already-dark starfield texture. */}
      <meshBasicMaterial
        map={milkyWayTexture}
        color={brightnessTint}
        side={BackSide}
        depthWrite={false}
        toneMapped={false}
        fog={false}
      />
    </mesh>
  );
}
