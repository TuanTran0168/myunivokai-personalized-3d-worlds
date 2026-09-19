"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { isNodeRenderer, loadedNodeMaterialModules } from "./nodeMaterials";
import {
  RGBA_BYTES_PER_PIXEL,
  WEBGL_READBACK_ROW_ALIGNMENT_BYTES,
  WEBGPU_READBACK_ROW_ALIGNMENT_BYTES,
  readbackRowStrideBytes,
  registerSceneStillSource,
  stillBytesHoldAPicture,
  toTopDownImageBytes,
  useComposedFrameDrawer,
  type SceneStillPicture
} from "./sceneStillCapture";

/**
 * THE ONE FRAME THE NODE PATH DRAWS SO THAT SOMETHING CAN BE READ BACK.
 *
 * Stage 0 of `agent-system/plans/frontend/webgpu-graphics-upgrade-roadmap.md`,
 * and the reason the rollout flag cannot go on without it: with the node
 * renderer drawing, the download button hands back a transparent PNG and every
 * world change becomes a hard cut, because `preserveDrawingBuffer` does not
 * exist on `WebGPURendererParameters` and the canvas reads back EMPTY — 0 of
 * 256 samples carrying alpha AND 0 of 256 carrying colour, on BOTH node
 * backends. `sceneStillCapture.ts` carries that measurement in full.
 *
 * # `setOutputRenderTarget`, WHICH IS THREE'S OWN ANSWER TO THIS
 *
 * The obvious shape — `setRenderTarget( target )`, render, read it back — is
 * wrong, and quietly: `Renderer.isOutputTarget` is
 * `this._renderTarget === this._outputRenderTarget || this._renderTarget === null`
 * (`three.webgpu.js:61704`), and `currentToneMapping` / `currentColorSpace`
 * collapse to `NoToneMapping` and the working colour space whenever it is false
 * (`:61681`, `:61693`). So a scene rendered through `setRenderTarget` comes back
 * **linear and un-tone-mapped** — a dark, flat, obviously wrong picture that
 * nothing in the app would have flagged as wrong for the right reason.
 *
 * `setOutputRenderTarget( target )` instead leaves `_renderTarget` null, so
 * `isOutputTarget` stays TRUE and three treats the target exactly as it treats
 * the canvas: `_getFrameBufferTarget()` builds the half-float intermediate
 * (`:60625`), the scene renders into that, and `_renderOutput()` writes the
 * tone-mapped, colour-space-converted result into the target (`:60957`). The
 * still is therefore the same arithmetic as the frame on screen rather than a
 * second one written here.
 *
 * # THE CAPTURE TARGET IS LINEAR ON PURPOSE, AND IT IS NOT A COLOUR BUG
 *
 * `_renderOutput` ENCODES to the output colour space in the shader. A target
 * whose texture carried `SRGBColorSpace` would be created as `rgba8unorm-srgb`
 * (`:77805`) and the hardware would encode a SECOND time on write. The target
 * is `LinearSRGBColorSpace` so the encoded bytes are stored verbatim, which is
 * what the canvas does too.
 *
 * # WHAT IT COSTS, SAID PLAINLY
 *
 * One extra full frame per capture — the scene is drawn again, through the same
 * post chain. Captures happen on a world change, a variant change, a gallery
 * reveal and a download click, never per frame and never under the parity
 * harness, so this is a doubled frame at the start of a 620 ms warp rather than
 * an ongoing cost. `sustained-load.spec.ts` would see it if that ever changed.
 */

/** Never mounted on the classic path. See `sceneStillCapture.ts`. */
export function SceneStillBridge() {
  const renderer = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const composedFrameDrawer = useComposedFrameDrawer();

  useEffect(() => {
    const nodeModules = loadedNodeMaterialModules();
    if (!nodeModules || !isNodeRenderer(renderer)) {
      return;
    }
    const { LinearFilter, LinearSRGBColorSpace, RenderTarget, RGBAFormat, UnsignedByteType, Vector2 } =
      nodeModules.webgpu;

    // Narrowed to what this file calls. R3F types `gl` as a `WebGLRenderer`,
    // and under the node renderer it is not one — the same cast every other
    // node-path file in this folder makes, for the same reason.
    const nodeRenderer = renderer as unknown as {
      backend?: { isWebGPUBackend?: boolean };
      getDrawingBufferSize: (target: { x: number; y: number }) => { x: number; y: number };
      getOutputRenderTarget: () => unknown;
      setOutputRenderTarget: (renderTarget: unknown) => void;
      render: (scene: unknown, camera: unknown) => void;
      readRenderTargetPixelsAsync: (
        renderTarget: unknown,
        x: number,
        y: number,
        width: number,
        height: number
      ) => Promise<ArrayBufferView>;
    };

    const drawingBufferSize = new Vector2();
    let captureTarget: InstanceType<typeof RenderTarget> | null = null;

    async function captureOneFrame(): Promise<SceneStillPicture | null> {
      nodeRenderer.getDrawingBufferSize(drawingBufferSize);
      const pixelWidth = Math.max(1, Math.round(drawingBufferSize.x));
      const pixelHeight = Math.max(1, Math.round(drawingBufferSize.y));

      if (captureTarget === null) {
        captureTarget = new RenderTarget(pixelWidth, pixelHeight, {
          format: RGBAFormat,
          type: UnsignedByteType,
          // See the header: the output pass encodes, so the target must not.
          colorSpace: LinearSRGBColorSpace,
          depthBuffer: true,
          stencilBuffer: false,
          generateMipmaps: false,
          minFilter: LinearFilter,
          magFilter: LinearFilter
        });
      } else if (captureTarget.width !== pixelWidth || captureTarget.height !== pixelHeight) {
        captureTarget.setSize(pixelWidth, pixelHeight);
      }

      const previousOutputRenderTarget = nodeRenderer.getOutputRenderTarget();
      nodeRenderer.setOutputRenderTarget(captureTarget);
      try {
        // Whoever owns the frame draws it. Null is the ocean, which mounts no
        // chain by design — see `sceneStillCapture.ts`.
        const drawComposedFrame = composedFrameDrawer.current;
        if (drawComposedFrame) {
          drawComposedFrame();
        } else {
          nodeRenderer.render(scene, camera);
        }
      } finally {
        // Restored before the readback is awaited, not after: an await here
        // would leave every frame drawn in the meantime going into the capture
        // target, and the canvas would freeze for the length of a GPU map.
        nodeRenderer.setOutputRenderTarget(previousOutputRenderTarget);
      }

      const readbackBytes = await nodeRenderer.readRenderTargetPixelsAsync(
        captureTarget,
        0,
        0,
        pixelWidth,
        pixelHeight
      );

      const rendersOnWebGPU = nodeRenderer.backend?.isWebGPUBackend === true;
      const topDownBytes = toTopDownImageBytes({
        bytes: new Uint8Array(readbackBytes.buffer, readbackBytes.byteOffset, readbackBytes.byteLength),
        pixelWidth,
        pixelHeight,
        rowStrideBytes: readbackRowStrideBytes(
          pixelWidth,
          RGBA_BYTES_PER_PIXEL,
          rendersOnWebGPU ? WEBGPU_READBACK_ROW_ALIGNMENT_BYTES : WEBGL_READBACK_ROW_ALIGNMENT_BYTES
        ),
        // `gl.readPixels` reads a framebuffer whose origin is bottom-left;
        // `copyTextureToBuffer` copies a texture whose origin is top-left.
        rowsRunBottomToTop: !rendersOnWebGPU
      });

      if (!stillBytesHoldAPicture(topDownBytes)) {
        return null;
      }
      return { bytes: topDownBytes, pixelWidth, pixelHeight };
    }

    const withdrawSource = registerSceneStillSource(async () => {
      try {
        return await captureOneFrame();
      } catch {
        // A capture that throws is a cut rather than a crash, which is what
        // every call site already does with a null. The alternative is a
        // rejected promise inside a click handler.
        return null;
      }
    });

    return () => {
      withdrawSource();
      captureTarget?.dispose();
      captureTarget = null;
    };
  }, [camera, composedFrameDrawer, renderer, scene]);

  return null;
}
