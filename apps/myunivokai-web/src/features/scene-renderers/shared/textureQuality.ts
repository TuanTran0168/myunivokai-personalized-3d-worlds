import { SRGBColorSpace, type Texture, type WebGLRenderer } from "three";

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
export function applyColorTextureQuality(texture: Texture, gl: WebGLRenderer): Texture {
  const anisotropy = gl.capabilities.getMaxAnisotropy();
  if (texture.colorSpace === SRGBColorSpace && texture.anisotropy === anisotropy) {
    return texture;
  }
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

/** Same anisotropy treatment for NON-color (data) maps: normal, roughness, alpha. */
export function applyDataTextureQuality(texture: Texture, gl: WebGLRenderer): Texture {
  const anisotropy = gl.capabilities.getMaxAnisotropy();
  if (texture.anisotropy === anisotropy) {
    return texture;
  }
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}
