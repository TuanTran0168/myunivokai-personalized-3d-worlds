import { useGLTF } from "@react-three/drei";

/**
 * Where the DRACO decoder is served from, and it is this origin.
 *
 * `@react-three/drei` defaults to `https://www.gstatic.com/draco/versioned/
 * decoders/1.5.5/` (see `node_modules/@react-three/drei/core/Gltf.js`), and
 * most of this app's `.glb` models carry `KHR_draco_mesh_compression`, so that
 * default is a load-bearing dependency on a Google host rather than an unused
 * fallback: without the decoder, the nature family's trees, animals and ground
 * decor render nothing at all.
 *
 * Two reasons to move it, and the first is the one that made it urgent:
 *
 * 1. The Content-Security-Policy added in S8-IDENTITY-004 blocks third-party
 *    script. Keeping the default would mean naming `https://www.gstatic.com`
 *    in `script-src` — a hole in the policy that nothing else in the app needs.
 * 2. It was already a third-party runtime dependency nobody had chosen. A
 *    scene that renders only while an unrelated host is reachable depends on
 *    that host whether or not anybody decided to.
 *
 * The trailing slash is required: DRACOLoader concatenates the file name onto
 * this string without inserting one.
 */
const LOCAL_DRACO_DECODER_PATH = "/vendor/draco/";

let decodersConfigured = false;

/**
 * Points drei's shared DRACOLoader at the self-hosted decoder.
 *
 * Called at module scope from the scene-renderer registry rather than from a
 * React effect, because it has to run before the first `useGLTF` — and
 * `useGLTF` is called during render, inside lazily-loaded renderer chunks, so
 * an effect anywhere would be too late for the first model of the first scene.
 *
 * Idempotent, because the registry module is imported by more than one route
 * and a second call would be a silent no-op either way — being explicit about
 * it costs one boolean and removes the question.
 */
export function configureLocalModelDecoders(): void {
  if (decodersConfigured) {
    return;
  }
  decodersConfigured = true;
  useGLTF.setDecoderPath(LOCAL_DRACO_DECODER_PATH);
}

/**
 * Exported for the test that asserts the path is a same-origin absolute path
 * and not a URL. A relative path would resolve against whatever route the
 * visitor happened to open the scene from.
 */
export function localDracoDecoderPath(): string {
  return LOCAL_DRACO_DECODER_PATH;
}
