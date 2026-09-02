"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Mesh } from "three";

// Shown inside the Canvas as the Suspense fallback while planet textures load,
// so the scene reveals with a quiet rotating brass armillary ring instead of an
// empty background. Unmounts automatically once the real scene is ready.
export function CanvasLoader() {
  const innerRingReference = useRef<Mesh>(null);
  const outerRingReference = useRef<Mesh>(null);

  useFrame((_, delta) => {
    if (innerRingReference.current) {
      innerRingReference.current.rotation.x += delta * 0.9;
      innerRingReference.current.rotation.y += delta * 1.2;
    }
    if (outerRingReference.current) {
      outerRingReference.current.rotation.z += delta * 0.5;
      outerRingReference.current.rotation.x -= delta * 0.35;
    }
  });

  return (
    <group>
      <mesh ref={outerRingReference}>
        <torusGeometry args={[1.25, 0.012, 12, 80]} />
        <meshBasicMaterial color="#C9A35B" transparent opacity={0.45} />
      </mesh>
      <mesh ref={innerRingReference}>
        <torusGeometry args={[0.85, 0.02, 16, 64]} />
        <meshBasicMaterial color="#E0573A" transparent opacity={0.7} />
      </mesh>
    </group>
  );
}
