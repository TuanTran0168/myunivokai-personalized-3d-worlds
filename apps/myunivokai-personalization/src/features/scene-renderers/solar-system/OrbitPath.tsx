"use client";

import { DoubleSide } from "three";

const ORBIT_PATH_THICKNESS = 0.018;
const ORBIT_PATH_OPACITY = 0.14;
const HIGHLIGHTED_ORBIT_PATH_OPACITY = 0.45;
const ORBIT_PATH_SEGMENTS = 160;

type OrbitPathProps = {
  radius: number;
  color: string;
  isHighlighted: boolean;
};

export function OrbitPath({ radius, color, isHighlighted }: OrbitPathProps) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry
        args={[radius - ORBIT_PATH_THICKNESS, radius + ORBIT_PATH_THICKNESS, ORBIT_PATH_SEGMENTS]}
      />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={isHighlighted ? HIGHLIGHTED_ORBIT_PATH_OPACITY : ORBIT_PATH_OPACITY}
        side={DoubleSide}
      />
    </mesh>
  );
}
