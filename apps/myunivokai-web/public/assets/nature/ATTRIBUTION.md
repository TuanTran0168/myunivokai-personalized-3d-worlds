# Nature asset catalog (nature-1) — sources and licenses

All 3D models under `models/` were downloaded from [Poly Pizza](https://poly.pizza)
and are self-hosted here. Files were optimized (Draco geometry compression,
textures resized to 512px WebP) with gltf-transform; contents are otherwise
unmodified. CC0 requires no attribution; CC-BY credits are listed as required.

## CC0 (public domain) — by [Quaternius](https://poly.pizza/u/Quaternius)

| File | Source |
| --- | --- |
| tree-birch-1.glb | <https://poly.pizza/m/R7qMWzb7nk> |
| tree-oak-1.glb | <https://poly.pizza/m/QVOop92WmG> |
| tree-oak-2.glb | <https://poly.pizza/m/aVOxaHRPWe> |
| tree-pine-1.glb | <https://poly.pizza/m/rfnxJv0Rqa> |
| tree-pine-2.glb | <https://poly.pizza/m/igSu0cPoBz> |
| tree-pine-snow-1.glb | <https://poly.pizza/m/17vQv2X5rh> |
| tree-dead-1.glb | <https://poly.pizza/m/n8FhMgMldD> |
| tree-dead-2.glb | <https://poly.pizza/m/MlmK5488ou> |
| rock-mossy-1.glb | <https://poly.pizza/m/KZdEP3uUpa> |
| rock-mossy-2.glb | <https://poly.pizza/m/s1OJ3bBzqc> |
| rock-mossy-3.glb | <https://poly.pizza/m/JQxF95498B> |
| grass-1.glb | <https://poly.pizza/m/vUJjrRsFp4> |
| grass-tall-1.glb | <https://poly.pizza/m/JSIYtscPmP> |
| flower-group-1.glb | <https://poly.pizza/m/hfPzQAedOe> |
| flower-single-1.glb | <https://poly.pizza/m/rHBoS64rRL> |
| bush-1.glb | <https://poly.pizza/m/EoTERLq3z2> |
| bush-flowers-1.glb | <https://poly.pizza/m/U1ymDy8tbY> |
| fern-1.glb | <https://poly.pizza/m/jqcanvH7D6> |
| mushroom-1.glb | <https://poly.pizza/m/aOW08oSrd4> |
| stump-moss-1.glb | <https://poly.pizza/m/nFvEbUX6LE> |
| animal-deer.glb | <https://poly.pizza/m/T6Cs7tmMHJ> |
| animal-fox.glb | <https://poly.pizza/m/Bc97C66HKi> |
| animal-wolf.glb | <https://poly.pizza/m/P1gU3Qkr9r> |
| animal-stag.glb | <https://poly.pizza/m/tQdzbZ1Cmw> |
| bird-armabee.glb | <https://poly.pizza/m/42djT5zJnx> |
| landmark-heart-tree.glb | <https://poly.pizza/m/9aWlx82xUf> |
| landmark-fallen-log.glb | <https://poly.pizza/m/nwsYvcI0bC> |

## CC0 (public domain) — other creators

| File | Creator | Source |
| --- | --- | --- |
| landmark-lantern-shrine.glb | [Kay Lousberg](https://poly.pizza/u/Kay%20Lousberg) | <https://poly.pizza/m/ZSQ65S4lEu> |

## CC-BY 3.0 (attribution required)

Licensed under [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/).

| File | Credit | Source |
| --- | --- | --- |
| bird-hawk.glb (rigged flap animation; also reused tinted as the special-bird crosser) | "Hawk Lp Rigged" by Sherkiz via Poly Pizza | <https://poly.pizza/m/RkN6MEbP6g> |

Retired: `animal-boar/rabbit/bear/squirrel.glb` used to be static Poly Pizza
models (Poly by Google / madtrollstudio, CC-BY 3.0). They had no animation, so
they slid across the ground without stepping; they were replaced by the rigged
models below.

## CC-BY 4.0 — Sketchfab (attribution required)

Licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
Credit must remain wherever this ships.

| File | Credit | Source |
| --- | --- | --- |
| tree-fir-realistic.glb | "Realistic Fir Trees Pack (LODS, gameready)" by LOLIPOP via Sketchfab | <https://sketchfab.com/3d-models/realistic-fir-trees-pack-lods-gameready-f58e8b6d733e4b0586e5b7db847b89e7> |
| tree-fir-distant.glb | same pack as above — LOD2 kept instead of LOD0, for the horizon belt | <https://sketchfab.com/3d-models/realistic-fir-trees-pack-lods-gameready-f58e8b6d733e4b0586e5b7db847b89e7> |
| tree-oak-realistic.glb | "oak trees" by DJMaesen via Sketchfab | <https://sketchfab.com/3d-models/oak-trees-d841c3bcc5324daebee50f45619e05fc> |
| animal-bear.glb | "Realistic Animated Bear 3D Model" by AnimalMesh 3D via Sketchfab | <https://sketchfab.com/3d-models/realistic-animated-bear-3d-model-bffc3c87d2d148ff8533e1cc8a11c9f1> |
| animal-boar.glb | "Animated Realistic Boar – 3D Animal Model" by AnimalMesh 3D via Sketchfab | <https://sketchfab.com/3d-models/animated-realistic-boar-3d-animal-model-f672a7fd93e84997b80a54ba30956111> |
| animal-rabbit.glb | "Hare (animated)" via Sketchfab | <https://sketchfab.com/3d-models/hare-animated-948938cd237d49a9868662213fa05543> |
| animal-squirrel.glb | "Squirrel - Animated Low Poly" via Sketchfab | <https://sketchfab.com/3d-models/squirrel-animated-low-poly-df896ee02a7a4592a5a544978d048440> |

For the four animals, only the single locomotion clip was kept (bear `Walk`,
boar/hare `Armature|walk`, squirrel `run` — a scamper is the correct squirrel
gait); every other clip was pruned (the bear alone shipped 81). Textures were
resized to 1024px WebP and geometry compressed with **EXT_meshopt_compression**,
not Draco, because Draco does not preserve skeletal animation. Combined
14MB+7.8MB+1.1MB+1.2MB → 0.59/0.60/0.14/0.09 MB.

Modifications: the shipped file keeps only the pack's **LOD0** meshes (three
distinct firs; LOD1–LOD3 and the billboards were pruned), textures resized to
2048px and re-encoded to WebP at quality 90, then geometry Draco-compressed —
7.1MB → 1.6MB. Geometry was deliberately **not** simplified: decimation
destroys the alpha-masked leaf cards that carry the realism.

## HDRIs — Poly Haven, CC0

1k pure-sky `.hdr` environments under `hdri/`, from [Poly Haven](https://polyhaven.com) (CC0):

| File | Source asset |
| --- | --- |
| nature-hdri-day.hdr | `kloofendal_48d_partly_cloudy_puresky` |
| nature-hdri-golden-hour.hdr | `industrial_sunset_puresky` |
| nature-hdri-dusk.hdr | `evening_road_01_puresky` |

## PBR textures — Poly Haven, CC0

1k tiling PBR maps under `textures/`, from [Poly Haven](https://polyhaven.com) (CC0).
Used as the forest ground's surface RELIEF only (normal + roughness); the ground
albedo stays vertex-colored and season-driven, so the maps add unevenness without
overriding the grass/leaf-litter/snow color logic.

| File | Source asset | Channel used |
| --- | --- | --- |
| forest-floor-normal-1k.jpg | `forest_floor` (nor_gl) | normal map |
| forest-floor-arm-1k.jpg | `forest_floor` (arm) | roughness (green channel) |
