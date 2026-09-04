# Self-hosted DRACO decoder

Copied verbatim from `node_modules/three/examples/jsm/libs/draco/gltf/` at
three **0.171.0** — the same two files `https://www.gstatic.com/draco/` serves,
which is where `@react-three/drei`'s `useGLTF` points by default
(`node_modules/@react-three/drei/core/Gltf.js`, `decoderPath`).

## Why they are committed here rather than fetched from Google

Most of this app's `.glb` models carry `KHR_draco_mesh_compression` — the
nature family's trees, animals and ground decor among them — so the decoder is
not optional: without it those scenes render nothing.

Two reasons it is served from this origin instead:

1. **The Content-Security-Policy added in S8-IDENTITY-004 blocks third-party
   script.** Once the product session lives anywhere JavaScript can read it, the
   CSP stops being hygiene and becomes a security control (identity plan §4.2),
   and a policy that has to name `https://www.gstatic.com` in `script-src` to
   keep the forest working is a policy with a hole in it that nothing else needs.
2. **It was already a third-party runtime dependency nobody had chosen.** A
   scene that renders correctly only while an unrelated Google host is reachable
   is a dependency on that host, whether or not anyone decided to take it.

`useGLTF.setDecoderPath` is called once with this directory —
see `src/features/scene-renderers/shared/modelDecoders.ts`.

## Updating

These files are version-locked to the `three` dependency, not to `drei`. When
`three` is upgraded, re-copy both files from the path above in the same change,
because the wrapper and the `.wasm` are a matched pair and a mixed pair fails
at decode time rather than at load time.

Only the WASM pair is here. `draco_decoder.js`, the pure-JavaScript fallback,
is 512 KB and is loaded only when `DRACOLoader.decoderConfig.type` is set to
`"js"`, which nothing in this app does — every browser that can run WebGL2
through React Three Fiber has WebAssembly.
