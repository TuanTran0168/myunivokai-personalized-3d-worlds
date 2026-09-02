"use client";

import { useEffect } from "react";
import { Environment, Lightformer } from "@react-three/drei";
import { useThree } from "@react-three/fiber";

/**
 * A tiny generated image-based-lighting environment — PBR spacecraft look
 * dead without one (solar panels and JWST's gold need something to reflect).
 * Rendered ONCE (frames={1}) from Lightformers into a small cubemap: a warm
 * "sun" rectangle plus a cool space fill. Fully procedural, so it honors the
 * self-hosted/no-CDN rule (never use drei's `preset` — that fetches an HDR
 * from a CDN at runtime).
 */

const ENVIRONMENT_CUBEMAP_RESOLUTION = 128;
// Subtle: planets keep their sun-lit look; the IBL only adds specular life.
const ENVIRONMENT_INTENSITY = 0.35;
const SUN_FORM_COLOR = "#FFE3B8";
const SUN_FORM_INTENSITY = 3;
const SPACE_FILL_COLOR = "#8FB6FF";
const SPACE_FILL_INTENSITY = 1.1;

export function SpaceEnvironment() {
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    scene.environmentIntensity = ENVIRONMENT_INTENSITY;
    return () => {
      scene.environmentIntensity = 1;
    };
  }, [scene]);

  return (
    <Environment frames={1} resolution={ENVIRONMENT_CUBEMAP_RESOLUTION}>
      <Lightformer form="rect" intensity={SUN_FORM_INTENSITY} color={SUN_FORM_COLOR} position={[0, 3, 8]} scale={[8, 4, 1]} />
      <Lightformer
        form="rect"
        intensity={SPACE_FILL_INTENSITY}
        color={SPACE_FILL_COLOR}
        position={[-7, -3, -6]}
        scale={[12, 7, 1]}
      />
    </Environment>
  );
}
