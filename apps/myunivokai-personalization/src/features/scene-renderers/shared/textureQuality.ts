import { SRGBColorSpace, type Mesh, type Object3D, type Texture } from "three";
import { maximumTextureAnisotropy } from "./textureAnisotropy";

/**
 * Texture sharpness defaults every scene texture should get.
 *
 * - colorSpace: three's TextureLoader leaves textures in NoColorSpace, so our
 *   sRGB-encoded JPGs were being sampled as if linear — washed-out, low
 *   contrast. Color maps must be tagged SRGBColorSpace (data maps — normal,
 *   roughness, alpha — must NOT be).
 * - anisotropy: the default of 1 collapses grazing-angle surfaces (Saturn's
 *   ring, planet limbs, the skybox band) into blurry mips; max anisotropy is
 *   essentially free on desktop GPUs.
 *
 * Safe to call repeatedly on useLoader-cached textures, and CHEAP to as well —
 * the early return below is the difference between the two.
 *
 * `needsUpdate = true` is not a flag saying "these settings changed"; it tells
 * three.js to re-upload the entire texture to the GPU on the next frame that
 * uses it. Setting it unconditionally, which this did, meant every re-render
 * that reached one of these helpers paid a full upload of an already-resident
 * texture. On the universe family that is several 8K JPEGs — 8192x4096 is
 * 134 MB of RGBA once decoded, before mipmaps — and it measured 1121 ms of
 * blocked main thread inside `texSubImage2D` on a single world switch.
 *
 * So: compare first, and only touch `needsUpdate` when a value actually
 * changed. A texture that already has the settings it is being asked for
 * needs no upload at all.
 */
export function applyColorTextureQuality(texture: Texture, gl?: unknown): Texture {
  const anisotropy = maximumTextureAnisotropy(gl);
  if (texture.colorSpace === SRGBColorSpace && texture.anisotropy === anisotropy) {
    return texture;
  }
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

/** Same anisotropy treatment for NON-color (data) maps: normal, roughness, alpha. */
export function applyDataTextureQuality(texture: Texture, gl?: unknown): Texture {
  const anisotropy = maximumTextureAnisotropy(gl);
  if (texture.anisotropy === anisotropy) {
    return texture;
  }
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The material slots that carry a COLOUR image, which must be tagged sRGB.
 *
 * Kept as data rather than as a chain of `if`s because the two lists below are
 * the whole difference between the two helpers above, and a slot in the wrong
 * list is a bug you see as a washed-out or an over-saturated surface rather
 * than as an error.
 */
const COLOUR_TEXTURE_SLOTS = ["map", "emissiveMap", "sheenColorMap", "specularColorMap"] as const;

/** The slots that carry MEASUREMENTS rather than colour, and must stay linear. */
const DATA_TEXTURE_SLOTS = [
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "alphaMap",
  "bumpMap",
  "displacementMap",
  "clearcoatNormalMap"
] as const;

type MaterialWithTextureSlots = Record<string, unknown> & { name?: string };

/**
 * GIVES EVERY TEXTURE INSIDE A LOADED MODEL THE SAME SHARPNESS THE HAND-LOADED
 * ONES HAVE HAD ALL ALONG.
 *
 * The two helpers above have existed since the universe family's planets were
 * sharpened, and until now they were called from `solar-system/` and nowhere
 * else — four call sites, all of them textures this app loads itself. **Every
 * texture that arrives inside a `.glb` kept three's default `anisotropy = 1`**:
 * all the bark, the leaf cards, the moss, the rock, the mushrooms, the
 * shipwreck. Those are precisely the grazing-angle surfaces the helpers' own
 * header was written about — a forest floor and a bark cylinder seen from a
 * walking-height camera are the textbook case — so the family that needed this
 * most was the one not getting it.
 *
 * # Why the renderer is optional here, and why that is not a shortcut
 *
 * `maximumTextureAnisotropy` returns 16 when it is handed nothing, and 16 is
 * not a guess: it is WebGPU's practical `maxAnisotropy` ceiling and the value
 * desktop WebGL drivers report, and a driver with a lower limit CLAMPS rather
 * than failing. `textureAnisotropy.ts` makes that argument at length. None of
 * the forest components calls `useThree`, so requiring a renderer here would
 * mean adding a hook to six components to obtain a number that is already
 * correct — and would make this helper harder to call from the plain
 * TypeScript of the model walk, which is where it belongs.
 *
 * Idempotent and cheap for the same reason the two helpers are: each returns
 * early when the texture already has what it is being asked for, so a model
 * re-prepared on a re-render uploads nothing.
 */
export function applyLoadedModelTextureQuality(modelRoot: Object3D, gl?: unknown): void {
  modelRoot.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) {
      return;
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) {
        continue;
      }
      const slots = material as unknown as MaterialWithTextureSlots;
      for (const slotName of COLOUR_TEXTURE_SLOTS) {
        const texture = slots[slotName] as Texture | null | undefined;
        if (texture?.isTexture) {
          applyColorTextureQuality(texture, gl);
        }
      }
      for (const slotName of DATA_TEXTURE_SLOTS) {
        const texture = slots[slotName] as Texture | null | undefined;
        if (texture?.isTexture) {
          applyDataTextureQuality(texture, gl);
        }
      }
    }
  });
}
