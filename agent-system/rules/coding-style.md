# Coding Style — Myunivokai

> **Document status:** Active policy
> **Last source review:** 2026-07-18

Applies to all code in this repo (Go backend and TypeScript frontend).

## 1. No hardcoded values

- Every magic number / magic string must become a named constant at the top of
  the file or in a dedicated config file.
- Tunable values (sizes, speeds, fallback colors, limits) are declared as
  constants with descriptive names.

```ts
// Wrong
const radius = 1.4 + random() * 3.8;

// Right
const MINIMUM_ORBIT_RADIUS = 1.4;
const ORBIT_RADIUS_RANGE = 3.8;
const orbitRadius = MINIMUM_ORBIT_RADIUS + random() * ORBIT_RADIUS_RANGE;
```

## 2. No abbreviated variable or function names

- Variable, function and type names are written out fully and explicitly.
- A reader should understand the code without comments decoding the names.

```ts
// Wrong
const cfg = getCfg();
function calcPos(p, t) {}

// Right
const sceneConfig = getSceneConfig();
function calculatePlanetPosition(planet: PlanetSceneConfig, elapsedTime: number) {}
```

## 3. Explicit beats clever

- Prefer clear, readable structure over "smart" but opaque code.
- One function does one thing, and its name says exactly what that is.
- Avoid nested ternaries; use if/else or extract a function.

## 4. Naming conventions

| Kind | Convention | Example |
|---|---|---|
| Constants (TS) | UPPER_SNAKE_CASE | `DEFAULT_CAMERA_DISTANCE` |
| Variables / functions (TS) | full camelCase | `selectedPlanetKey`, `buildParticlePositions` |
| React components | PascalCase | `PlanetDetailsPanel` |
| Constants / variables (Go) | Go style, but fully spelled out | `defaultOrbitSpeed` |

## 5. Frontend specifics

- Never call AI from the frontend (rule in AGENTS.md).
- Every 3D scene value must come from the backend `WorldSceneConfig`;
  named fallback constants are used only when config is missing.
- FE types must mirror the BE JSON contract (`contracts/schemas/`).
