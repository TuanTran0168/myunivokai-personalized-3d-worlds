# Model Attribution

Spacecraft and asteroid models in this folder are from
[NASA 3D Resources](https://science.nasa.gov/3d-resources/)
(GitHub mirror: nasa/NASA-3D-Resources). NASA content is generally not
subject to copyright in the United States and may be used for commercial
purposes without explicit permission; it must not be used to imply NASA
endorsement, and the NASA insignia is protected. Credit: NASA.

- `hubble.glb` — Hubble Space Telescope (model "A")
- `jwst.glb` — James Webb Space Telescope (model "B")
- `cassini.glb` — Cassini-Huygens (model "A")
- `voyager.glb` — Voyager probe (model "B")
- `bennu.glb` — Asteroid 101955 Bennu radar shape model ("1999 RQ36")

Adaptations: re-encoded from NASA's Draco GLBs to meshopt
(EXT_meshopt_compression) with WebP textures capped at 1024px via
`@gltf-transform/cli optimize` for web delivery.

## Sketchfab CC-BY 4.0 (attribution required)

Licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
Credit must remain wherever this ships.

- `black-hole.glb` — "Blackhole" by rubykamen via Sketchfab —
  <https://sketchfab.com/3d-models/blackhole-74cbeaeae2174a218fe9455d77902b5c>
  Black core with emissive accretion rings and a baked swirl animation. Wired as
  the seed-gated "black-hole" rare feature (see
  `src/features/scene-renderers/solar-system/DistantBlackHole.tsx`).

Modifications: optimized with `@gltf-transform/cli` — textures resized to
2048px WebP, then EXT_meshopt_compression. Animation preserved.
