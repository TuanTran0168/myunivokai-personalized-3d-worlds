"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Spherical, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImplementation } from "three-stdlib";
import { REDUCED_MOTION_MEDIA_QUERY } from "@/lib/formRailCollapse";
import { usePlanetPositionTracker } from "./PlanetPositionTracker";
import { useTerrainHeightSampler } from "./TerrainHeightSampler";
import {
  CAMERA_INTRO_START_POSE,
  cameraIntroFrameSeconds,
  cameraIntroOffsetAt,
  cameraIntroProgress,
  cameraIntroStartOffset,
  cameraIntroPoseForDuration,
  pickCameraIntroPose,
  type SphericalOffset
} from "./cameraIntro";

// How far above the sampled terrain the lens must stay. Small enough that
// approaching the seabed still feels like approaching it, large enough that
// the near clip plane and the sand stop fighting.
const MINIMUM_HEIGHT_ABOVE_TERRAIN_METRES = 1.5;

const ORBIT_CONTROLS_MINIMUM_DISTANCE = 2.5;
const ORBIT_CONTROLS_MAXIMUM_DISTANCE = 26;
// No polar clamp by default: universe scenes are viewable from below.
const ORBIT_CONTROLS_MAXIMUM_POLAR_ANGLE = Math.PI;
const CAMERA_FOCUS_LERP_SPEED = 3.2;
const SCENE_CENTER = new Vector3(0, 0, 0);

// WASD / arrow-key glide across the scene. Speed scales with zoom distance so
// it feels the same whether you are close in or pulled far out.
const KEYBOARD_PAN_SPEED_PER_DISTANCE = 0.8;
const KEYBOARD_PAN_SPEED_MINIMUM = 5;
const KEYBOARD_PAN_SPEED_MAXIMUM = 55;
const MOVE_FORWARD_KEYS = new Set(["w", "arrowup"]);
const MOVE_BACKWARD_KEYS = new Set(["s", "arrowdown"]);
const MOVE_LEFT_KEYS = new Set(["a", "arrowleft"]);
const MOVE_RIGHT_KEYS = new Set(["d", "arrowright"]);
const ALL_MOVE_KEYS = new Set([...MOVE_FORWARD_KEYS, ...MOVE_BACKWARD_KEYS, ...MOVE_LEFT_KEYS, ...MOVE_RIGHT_KEYS]);

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }
  const tagName = element.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || element.isContentEditable;
}

type CameraRigProps = {
  selectedPlanetKey: string | null;
  /** Scene families with a ground plane pass their own zoom/tilt envelope. */
  minimumDistance?: number;
  maximumDistance?: number;
  maximumPolarAngleRadians?: number;
  /** Decorative canvases (gallery backdrop) opt out of keyboard movement. */
  keyboardMoveEnabled?: boolean;
  /**
   * Where the camera rests its aim when nothing is selected.
   *
   * Defaults to the scene centre, which is right for a solar system seen from
   * outside and wrong for a medium the camera is INSIDE. An ocean camera has to
   * aim relative to itself — 60 degrees up into Snell's window, or down along a
   * glitter path — and a target pinned to the origin makes every such angle come
   * out roughly halved, because the horizontal run to the origin is the orbit
   * radius no matter what pitch was asked for. Families that know where they
   * want to look pass it; nothing else changes.
   */
  restingTarget?: { x: number; y: number; z: number };
  /**
   * Length of the opening move, in seconds. 0 parks the camera on the framing
   * immediately, which is what the decorative gallery backdrops want and what
   * `prefers-reduced-motion: reduce` forces regardless of what is passed.
   */
  introDurationSeconds?: number;
  /**
   * Where the opening move is in its life.
   *
   * `waiting` — the scene has not rendered a frame yet, so the move must not
   * start: it would spend itself behind a loading veil and reveal a camera that
   * had already arrived.
   * `held` — pose the camera at the start of the move but do not advance it.
   * The genie reveal uses this while it unfolds a still of the first frame:
   * a camera that kept moving underneath would no longer match the still by the
   * time the two are swapped.
   * `running` — advance.
   */
  introPhase?: "waiting" | "held" | "running";
  /**
   * Which of the opening shots this scene gets. The scene seed, normally — the
   * same world then opens the same way every visit while different worlds open
   * differently. Omitted, every scene opens on the canonical pull-back.
   */
  introPoseSeed?: string;
};

/**
 * Orbit controls plus a smooth "fly to selected object" focus animation
 * (inspired by NASA Eyes) and WASD / arrow-key free-roam panning. When a
 * planet/landmark/animal is selected the target glides to it and follows;
 * otherwise the keyboard glides the whole rig across the scene.
 */
export function CameraRig({
  selectedPlanetKey,
  minimumDistance = ORBIT_CONTROLS_MINIMUM_DISTANCE,
  maximumDistance = ORBIT_CONTROLS_MAXIMUM_DISTANCE,
  maximumPolarAngleRadians = ORBIT_CONTROLS_MAXIMUM_POLAR_ANGLE,
  keyboardMoveEnabled = true,
  restingTarget,
  introDurationSeconds = 0,
  introPhase = "waiting",
  introPoseSeed
}: CameraRigProps) {
  const orbitControlsReference = useRef<OrbitControlsImplementation>(null);
  const planetPositionTracker = usePlanetPositionTracker();
  const terrainHeightSampler = useTerrainHeightSampler();
  const desiredTarget = useMemo(() => new Vector3(), []);
  const camera = useThree((state) => state.camera);

  const pressedKeysRef = useRef<Set<string>>(new Set());
  // Once the user drives with the keyboard we stop auto-recentering the target,
  // so free-roam position is not yanked back to the origin every frame.
  const hasFreeRoamedRef = useRef(false);

  // Opening move. The resting offset is captured on the first armed frame —
  // that is the framing the family solved, before anything here has touched it.
  const introRestingOffsetReference = useRef<SphericalOffset | null>(null);
  const introStartOffsetReference = useRef<SphericalOffset | null>(null);
  const introElapsedSecondsReference = useRef(0);
  const isIntroSpentReference = useRef(false);
  const prefersReducedMotionReference = useRef(false);
  const introSpherical = useMemo(() => new Spherical(), []);
  const scratchIntroOffset = useMemo(() => new Vector3(), []);
  // Sized for the duration it has to play in: the full cinematic entry gets the
  // whole shot, the create page's short settle gets a fraction of it rather
  // than the same travel at two and a half times the speed.
  const introPose = useMemo(
    () =>
      cameraIntroPoseForDuration(
        introPoseSeed ? pickCameraIntroPose(introPoseSeed) : CAMERA_INTRO_START_POSE,
        introDurationSeconds
      ),
    [introPoseSeed, introDurationSeconds]
  );

  useEffect(() => {
    prefersReducedMotionReference.current = window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches;
  }, []);

  // The move yields to the visitor the instant they reach for the scene. Hooked
  // to the controls' own "start" event rather than window pointer events: that
  // is the one signal that already means "this drag/pinch/wheel is going to
  // move the camera", and it fires for touch and trackpad the same way.
  useEffect(() => {
    const orbitControls = orbitControlsReference.current;
    if (!orbitControls) {
      return;
    }
    function endIntro() {
      isIntroSpentReference.current = true;
    }
    orbitControls.addEventListener("start", endIntro);
    return () => orbitControls.removeEventListener("start", endIntro);
  }, []);

  useEffect(() => {
    if (!keyboardMoveEnabled) {
      return;
    }
    // The ref's Set identity is stable; capture it so the cleanup closes over
    // the same object the handlers mutate.
    const pressedKeys = pressedKeysRef.current;
    function handleKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      if (!ALL_MOVE_KEYS.has(key) || isTypingTarget(event.target)) {
        return;
      }
      // Stop arrow keys from scrolling the page while roaming the scene.
      event.preventDefault();
      pressedKeys.add(key);
    }
    function handleKeyUp(event: KeyboardEvent) {
      pressedKeys.delete(event.key.toLowerCase());
    }
    function clearKeys() {
      pressedKeys.clear();
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    // A lost focus (tab switch) would otherwise strand a key as "held".
    window.addEventListener("blur", clearKeys);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", clearKeys);
      pressedKeys.clear();
    };
  }, [keyboardMoveEnabled]);

  // Snapped on the first frame, never lerped in from the scene centre.
  //
  // OrbitControls derives the camera position from (target, spherical offset) on
  // every update, so MOVING the target drags the camera with it. Lerping the
  // target 20 m forward therefore also walked the camera 20 m forward — which,
  // in an ocean, walked it into the boulder field and filled the frame with one
  // white rock face. The offset has to be right from the first update instead.
  const appliedRestingTargetRef = useRef<string | null>(null);

  const scratchForward = useMemo(() => new Vector3(), []);
  const scratchRight = useMemo(() => new Vector3(), []);
  const scratchMove = useMemo(() => new Vector3(), []);

  // Terrain clamp, extracted so the opening move gets it too. Only a family with
  // a ground plane (ocean) ever sets the sampler; every other family's clamp
  // here is a no-op.
  //
  // Shifting camera.position AND orbitControls.target by the same delta — not
  // position alone — is the same technique the WASD block below already uses to
  // move the rig without changing what it is looking at: OrbitControls derives
  // position from (target, spherical offset), so translating both by one vector
  // preserves the offset and therefore the view, while translating position
  // alone would silently re-pitch the camera toward whatever it had just been
  // clamped away from.
  function clampCameraAboveTerrain(orbitControls: OrbitControlsImplementation) {
    const sampleTerrainHeight = terrainHeightSampler.current;
    if (!sampleTerrainHeight) {
      return;
    }
    const minimumY = sampleTerrainHeight(camera.position.x, camera.position.z) + MINIMUM_HEIGHT_ABOVE_TERRAIN_METRES;
    if (camera.position.y < minimumY) {
      const deltaY = minimumY - camera.position.y;
      camera.position.y += deltaY;
      orbitControls.target.y += deltaY;
      orbitControls.update();
    }
  }

  useFrame((_, deltaTimeSeconds) => {
    const orbitControls = orbitControlsReference.current;
    if (!orbitControls) {
      return;
    }

    if (restingTarget) {
      const key = `${restingTarget.x},${restingTarget.y},${restingTarget.z}`;
      if (appliedRestingTargetRef.current !== key) {
        appliedRestingTargetRef.current = key;
        orbitControls.target.set(restingTarget.x, restingTarget.y, restingTarget.z);
        orbitControls.update();
      }
    }

    // Opening move, ahead of everything else and returning while it runs: a
    // focus glide or a WASD glide fighting the entrance for the same camera
    // would read as two shots at once. Both are still reachable — the first
    // touch on the controls, or the first movement key, spends the move.
    const introDuration = prefersReducedMotionReference.current ? 0 : introDurationSeconds;
    if (introPhase !== "waiting" && introDuration > 0 && !isIntroSpentReference.current) {
      if (pressedKeysRef.current.size > 0) {
        isIntroSpentReference.current = true;
      } else {
        let restingOffset = introRestingOffsetReference.current;
        if (!restingOffset || !introStartOffsetReference.current) {
          introSpherical.setFromVector3(scratchIntroOffset.copy(camera.position).sub(orbitControls.target));
          restingOffset = {
            radius: introSpherical.radius,
            polarRadians: introSpherical.phi,
            azimuthRadians: introSpherical.theta
          };
          introRestingOffsetReference.current = restingOffset;
          introStartOffsetReference.current = cameraIntroStartOffset(
            restingOffset,
            {
              minimumRadius: minimumDistance,
              maximumRadius: maximumDistance,
              maximumPolarRadians: maximumPolarAngleRadians
            },
            introPose
          );
        }

        if (introPhase === "running") {
          introElapsedSecondsReference.current += cameraIntroFrameSeconds(deltaTimeSeconds);
        }
        const progress = cameraIntroProgress(introElapsedSecondsReference.current, introDuration);
        const offset = cameraIntroOffsetAt(introStartOffsetReference.current, restingOffset, progress);
        introSpherical.set(offset.radius, offset.polarRadians, offset.azimuthRadians);
        camera.position.copy(orbitControls.target).add(scratchIntroOffset.setFromSpherical(introSpherical));
        orbitControls.update();
        if (progress >= 1) {
          isIntroSpentReference.current = true;
        }
        clampCameraAboveTerrain(orbitControls);
        return;
      }
    }

    const selectedPlanetPosition = selectedPlanetKey ? planetPositionTracker.get(selectedPlanetKey) : undefined;

    if (selectedPlanetKey) {
      // Focus mode: glide the target onto the selection and follow it.
      hasFreeRoamedRef.current = false;
      desiredTarget.copy(selectedPlanetPosition ?? SCENE_CENTER);
      const frameLerpFactor = 1 - Math.exp(-CAMERA_FOCUS_LERP_SPEED * deltaTimeSeconds);
      orbitControls.target.lerp(desiredTarget, frameLerpFactor);
      orbitControls.update();
      return;
    }

    // Free-roam: apply keyboard panning (target + camera move together).
    const pressedKeys = pressedKeysRef.current;
    let forwardInput = 0;
    let rightInput = 0;
    for (const key of pressedKeys) {
      if (MOVE_FORWARD_KEYS.has(key)) forwardInput += 1;
      if (MOVE_BACKWARD_KEYS.has(key)) forwardInput -= 1;
      if (MOVE_RIGHT_KEYS.has(key)) rightInput += 1;
      if (MOVE_LEFT_KEYS.has(key)) rightInput -= 1;
    }

    if (forwardInput !== 0 || rightInput !== 0) {
      hasFreeRoamedRef.current = true;
      // Horizontal forward = camera look direction flattened to the ground.
      scratchForward.copy(orbitControls.target).sub(camera.position);
      scratchForward.y = 0;
      if (scratchForward.lengthSq() < 0.000001) {
        scratchForward.set(0, 0, -1);
      }
      scratchForward.normalize();
      scratchRight.crossVectors(scratchForward, camera.up).normalize();

      const distance = camera.position.distanceTo(orbitControls.target);
      const panSpeed = Math.min(
        KEYBOARD_PAN_SPEED_MAXIMUM,
        Math.max(KEYBOARD_PAN_SPEED_MINIMUM, distance * KEYBOARD_PAN_SPEED_PER_DISTANCE)
      );
      scratchMove
        .set(0, 0, 0)
        .addScaledVector(scratchForward, forwardInput)
        .addScaledVector(scratchRight, rightInput);
      if (scratchMove.lengthSq() > 0.000001) {
        scratchMove.normalize().multiplyScalar(panSpeed * deltaTimeSeconds);
        camera.position.add(scratchMove);
        orbitControls.target.add(scratchMove);
      }
    } else if (!hasFreeRoamedRef.current) {
      // Idle and never roamed: gently keep the target where the family wants it,
      // which is the scene centre unless one asked for its own aim.
      const frameLerpFactor = 1 - Math.exp(-CAMERA_FOCUS_LERP_SPEED * deltaTimeSeconds);
      if (restingTarget) {
        desiredTarget.set(restingTarget.x, restingTarget.y, restingTarget.z);
        orbitControls.target.lerp(desiredTarget, frameLerpFactor);
      } else {
        orbitControls.target.lerp(SCENE_CENTER, frameLerpFactor);
      }
    }
    orbitControls.update();

    // Terrain clamp, last, so it corrects whatever this frame's zoom/orbit/pan
    // just produced rather than something a later step could still undo.
    clampCameraAboveTerrain(orbitControls);
  });

  return (
    <OrbitControls
      ref={orbitControlsReference}
      enablePan={false}
      minDistance={minimumDistance}
      maxDistance={maximumDistance}
      maxPolarAngle={maximumPolarAngleRadians}
    />
  );
}
