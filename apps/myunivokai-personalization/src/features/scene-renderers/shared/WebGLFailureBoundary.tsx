"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Renders a stated failure instead of a blank rectangle when the 3D canvas
 * cannot draw.
 *
 * `frontend-plan.md` gap #4 named this as missing, and the shape of the gap is
 * the reason it is worth having: when WebGL fails, nothing throws that anybody
 * sees. The page keeps its layout, the canvas keeps its size, the loading hold
 * has already passed, and the visitor is looking at a correctly-sized area of
 * background colour with no way to tell whether their world is still coming,
 * failed, or never existed. All three read as "the product is broken", and only
 * one of them is even true.
 *
 * Two different failures land here, by two different routes:
 *
 *  - **Context creation and render-time errors** throw during React's render or
 *    commit, which is what `getDerivedStateFromError` catches. A shader compile
 *    that three.js reports as an exception arrives this way too.
 *  - **Context LOSS** throws nothing at all. The GPU takes the context away — a
 *    driver reset, a laptop switching between integrated and discrete graphics,
 *    a phone reclaiming memory under pressure, or the browser's own per-page
 *    context cap evicting the oldest one — and the canvas simply stops. Hence
 *    the listener as well as the boundary.
 *
 * # Why this adds no element to the DOM
 *
 * It renders its children directly. An earlier version wrapped them in a
 * `h-full w-full` div to hold the listener, and that div was the ONLY thing in
 * this story capable of moving a pixel on a machine that classifies at the top
 * tier — the story's fourth scenario requires that output to be unchanged, and
 * an extra level of percentage-height nesting inside a `min-h` parent is
 * exactly the kind of change that is hard to reason about and easy to regress.
 *
 * So the `webglcontextlost` listener goes on `window` in the CAPTURE phase
 * instead. Capture is not a detail: the event does not bubble, so a listener
 * anywhere above the canvas can only ever see it on the way down. The trade is
 * that the listener is page-wide rather than subtree-scoped, so the target is
 * checked before it is believed.
 */

type WebGLFailureBoundaryProps = {
  children: ReactNode;
  /** Shown in place of the canvas. Defaults to the messages below. */
  fallback?: ReactNode;
  /** Optional hook for telemetry or a family-specific message. */
  onFailure?: (reason: WebGLFailureReason) => void;
};

export type WebGLFailureReason = "render-error" | "context-lost";

type WebGLFailureBoundaryState = {
  failureReason: WebGLFailureReason | null;
};

const FAILURE_MESSAGES: Record<WebGLFailureReason, { heading: string; detail: string }> = {
  "render-error": {
    heading: "This world could not be drawn",
    detail:
      "Your browser could not start 3D rendering for it. This is usually hardware acceleration being switched off, or a graphics driver the browser has blocked."
  },
  "context-lost": {
    heading: "The 3D view was interrupted",
    detail:
      "Your device took the graphics context back, which usually means it was low on memory or switched graphics cards. Reloading the page restores it."
  }
};

export class WebGLFailureBoundary extends Component<WebGLFailureBoundaryProps, WebGLFailureBoundaryState> {
  state: WebGLFailureBoundaryState = { failureReason: null };

  static getDerivedStateFromError(): WebGLFailureBoundaryState {
    return { failureReason: "render-error" };
  }

  componentDidMount() {
    if (typeof window !== "undefined") {
      window.addEventListener("webglcontextlost", this.handleContextLost, { capture: true });
    }
  }

  componentWillUnmount() {
    if (typeof window !== "undefined") {
      window.removeEventListener("webglcontextlost", this.handleContextLost, { capture: true });
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Logged rather than swallowed: the fallback tells the visitor what
    // happened, and this is the only record of WHY that reaches a developer.
    // eslint-disable-next-line no-console
    console.error("3D canvas failed to render", error, errorInfo.componentStack);
    this.props.onFailure?.("render-error");
  }

  private handleContextLost = (event: Event) => {
    // The listener is page-wide, so the target is verified rather than assumed.
    // Anything that is not a canvas losing a WebGL context is not this
    // boundary's business.
    if (!(event.target instanceof HTMLCanvasElement)) {
      return;
    }
    // Calling preventDefault is what tells the browser the page intends to
    // restore the context rather than having abandoned it. It is called even
    // though this boundary does not restore automatically, because it keeps a
    // reload able to succeed without a full process restart.
    event.preventDefault();
    this.props.onFailure?.("context-lost");
    this.setState({ failureReason: "context-lost" });
  };

  render() {
    const { failureReason } = this.state;

    if (!failureReason) {
      // No wrapper element. See the note above — this is load-bearing for the
      // story's "top tier renders identically" requirement.
      return this.props.children;
    }

    if (this.props.fallback !== undefined) {
      return this.props.fallback;
    }

    const message = FAILURE_MESSAGES[failureReason];
    return (
      <div role="status" className="flex h-full w-full items-center justify-center p-6 text-center">
        <div className="max-w-sm space-y-2">
          <p className="text-sm font-medium text-white/90">{message.heading}</p>
          <p className="text-xs leading-relaxed text-white/60">{message.detail}</p>
        </div>
      </div>
    );
  }
}
