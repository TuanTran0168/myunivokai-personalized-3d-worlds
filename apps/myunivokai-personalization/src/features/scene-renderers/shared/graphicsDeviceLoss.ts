import { isUnexpectedDeviceLoss } from "./rendererSelection";

/**
 * THE FAILURE MODE WEBGL2 DOES NOT HAVE.
 *
 * §26 Phase 9, §18.3(b). `WebGPURenderer` installs its own fallback and it
 * covers four of the five gates in §18.2 — secure context, `navigator.gpu`,
 * `requestAdapter()` and `requestDevice()`. It does not cover the fifth, and the
 * fifth is not a gate at all: `GPUDevice.lost` is a promise that stays pending
 * for the device's whole lifetime and resolves whenever the driver takes it
 * away. There is no equivalent in WebGL2 — a lost WebGL context fires an EVENT
 * on the canvas, which `WebGLFailureBoundary` already listens for, and nothing
 * fires here.
 *
 * MDN is explicit about the cost of recovering properly: *"any WebGPU resources
 * created with a previous device (buffers, textures, etc.) will need to be
 * re-created with the new one."* For this app that is the forest's
 * `InstancedMesh` buffers, every `CanvasTexture` and `DataTexture` upload, the
 * GLTF geometry and the whole post chain — a per-family piece of work, for an
 * event most visitors will never see. §18.3(b) picks the cheap correct answer
 * instead: **remount the canvas, which this component already does once per
 * world, onto the WebGL2 path.**
 *
 * # The two things that make this quiet rather than noisy
 *
 * **`device.destroy()` resolves the same promise.** The renderer destroys its
 * device on dispose and this app disposes a canvas per world — every interest
 * chip, every nickname edit, every family switch. Without the reason check in
 * `isUnexpectedDeviceLoss`, the first ordinary remount would look like a driver
 * failure and push the visitor onto the fallback permanently.
 *
 * **There may be no device to watch, and that is the ordinary case.** The
 * WebGL2 backend has no `GPUDevice`, so roughly 20% of visitors (§19.5) reach
 * this function and correctly find nothing. A null here is not an error and must
 * not be logged as one.
 */

type RendererWithDevice = {
  backend?: {
    device?: {
      lost?: Promise<{ reason?: string; message?: string }>;
    };
  };
};

/**
 * Calls back once if this renderer's GPU device is lost for a reason that is
 * not the app destroying it.
 *
 * Returns whether there was a device to watch, so a caller can tell "WebGL2
 * backend, nothing to watch" apart from "watching". Nothing here throws: a
 * renderer that does not expose a device, or exposes one without a `lost`
 * promise, is simply not watched.
 */
export function watchGraphicsDevice(renderer: unknown, onUnexpectedLoss: (reason: string) => void): boolean {
  const lost = (renderer as RendererWithDevice | null | undefined)?.backend?.device?.lost;
  if (!lost || typeof lost.then !== "function") {
    return false;
  }
  void lost.then((information) => {
    const reason = information?.reason ?? "unknown";
    if (isUnexpectedDeviceLoss(reason)) {
      onUnexpectedLoss(reason);
    }
  });
  return true;
}
