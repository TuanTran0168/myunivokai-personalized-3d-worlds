"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Group } from "three";
import { paletteFromScene, randomFromSeed } from "@/lib/scene";
import type { SceneRendererProps } from "../types";
import { StarParticleField } from "../shared/StarParticleField";

const FALLBACK_BODY_COUNT = 18;
const FALLBACK_GROUP_ROTATION_SPEED = 0.08;
const MINIMUM_BODY_ORBIT_RADIUS = 1.4;
const BODY_ORBIT_RADIUS_RANGE = 3.8;
const MINIMUM_BODY_HEIGHT = -0.55;
const BODY_HEIGHT_RANGE = 1.7;
const MINIMUM_BODY_SCALE = 0.12;
const BODY_SCALE_RANGE = 0.42;

/**
 * Abstract decorative universe used when there is no WorldSceneConfig yet
 * (for example the landing page preview before a world is generated).
 */
export function FallbackUniverseRenderer({ scene, seed }: SceneRendererProps) {
  const fallbackGroupReference = useRef<Group>(null);
  const palette = paletteFromScene(scene);

  const fallbackBodies = useMemo(() => {
    const random = randomFromSeed(seed);
    return Array.from({ length: FALLBACK_BODY_COUNT }, (_, bodyIndex) => {
      const bodyOrbitRadius = MINIMUM_BODY_ORBIT_RADIUS + random() * BODY_ORBIT_RADIUS_RANGE;
      const bodyAngle = random() * Math.PI * 2;
      const bodyHeight = MINIMUM_BODY_HEIGHT + random() * BODY_HEIGHT_RANGE;
      return {
        color: palette[bodyIndex % palette.length],
        position: [
          Math.cos(bodyAngle) * bodyOrbitRadius,
          bodyHeight,
          Math.sin(bodyAngle) * bodyOrbitRadius
        ] as [number, number, number],
        scale: MINIMUM_BODY_SCALE + random() * BODY_SCALE_RANGE,
        rotationOffset: random() * Math.PI * 2
      };
    });
  }, [palette, seed]);

  useFrame(({ clock }) => {
    if (!fallbackGroupReference.current) {
      return;
    }
    fallbackGroupReference.current.rotation.y = clock.elapsedTime * FALLBACK_GROUP_ROTATION_SPEED;
  });

  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight position={[4, 7, 3]} intensity={1.3} />
      <pointLight position={[0, 0, 0]} intensity={2.4} color={palette[1]} />
      <StarParticleField scene={scene} seed={seed} fallbackColor={palette[1]} />
      <group ref={fallbackGroupReference}>
        <mesh>
          <icosahedronGeometry args={[0.92, 2]} />
          <meshStandardMaterial color={palette[0]} roughness={0.44} metalness={0.18} />
        </mesh>
        {fallbackBodies.map((body, bodyIndex) => (
          <group key={`${seed}-${bodyIndex}`} rotation={[0, body.rotationOffset, 0]}>
            <mesh position={body.position}>
              {bodyIndex % 3 === 0 ? (
                <octahedronGeometry args={[body.scale, 1]} />
              ) : (
                <sphereGeometry args={[body.scale, 24, 16]} />
              )}
              <meshStandardMaterial color={body.color} roughness={0.52} metalness={0.24} />
            </mesh>
          </group>
        ))}
      </group>
    </>
  );
}
