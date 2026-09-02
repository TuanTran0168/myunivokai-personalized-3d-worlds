"use client";

import { useEffect, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  EXPANDED_FORM_RAIL_COLLAPSE_STATE,
  formRailLayoutReleaseDelayMilliseconds,
  formRailStateAfterErrorChange,
  formRailToggleLabel,
  IMMERSIVE_WORLD_BODY_ATTRIBUTE,
  REDUCED_MOTION_MEDIA_QUERY,
  releaseFormRailLayoutSpace,
  toggleFormRailCollapseState,
  worldChromeToggleAccessibleLabel,
  WORLD_FAMILY_BODY_ATTRIBUTE,
  type FormRailCollapseState,
  type WorldChromeNoun
} from "@/lib/formRailCollapse";
import type { WorldFamily } from "@/lib/types";

// The one control that clears the interface off a live world, shared by the
// create, world and share pages. Each page hides a different thing — a form on
// one, HUD islands on the other two — but the state, the timing, the body
// markers and the button are the same, and were not worth writing three times.

type WorldChromeCollapseOptions = {
  /**
   * Rendered inside the collapsing region on the create page. A message arriving
   * while the region is hidden has to reopen it, or the user sees nothing
   * happen. Pages whose errors surface as toasts leave this empty.
   */
  errorMessage?: string;
  /**
   * Drives the accent metal. Published on <body> because the fixed header and
   * footer are not any page's descendants.
   */
  worldFamily?: WorldFamily;
};

export function useWorldChromeCollapse({ errorMessage = "", worldFamily }: WorldChromeCollapseOptions = {}) {
  const [collapseState, setCollapseState] = useState<FormRailCollapseState>(EXPANDED_FORM_RAIL_COLLAPSE_STATE);
  const toggleButtonReference = useRef<HTMLButtonElement | null>(null);

  // The collapsing region keeps its box in the mobile document flow until the
  // slide has played, so nothing below it moves while it is still visible.
  useEffect(() => {
    if (collapseState.isExpanded || !collapseState.reservesLayoutSpace) {
      return;
    }
    const prefersReducedMotion = window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches;
    const timeoutId = setTimeout(
      () => setCollapseState(releaseFormRailLayoutSpace),
      formRailLayoutReleaseDelayMilliseconds(prefersReducedMotion)
    );
    return () => clearTimeout(timeoutId);
  }, [collapseState]);

  useEffect(() => {
    setCollapseState((current) => formRailStateAfterErrorChange(current, errorMessage));
  }, [errorMessage]);

  // Hiding clears the WHOLE interface — the shared header and footer included,
  // and those live in an ancestor layout no selector here can reach. The cleanup
  // is not optional: without it, navigating away while hidden would leave every
  // other page with no header.
  useEffect(() => {
    if (collapseState.isExpanded) {
      return;
    }
    document.body.setAttribute(IMMERSIVE_WORLD_BODY_ATTRIBUTE, "true");
    return () => document.body.removeAttribute(IMMERSIVE_WORLD_BODY_ATTRIBUTE);
  }, [collapseState.isExpanded]);

  useEffect(() => {
    if (!worldFamily) {
      return;
    }
    document.body.setAttribute(WORLD_FAMILY_BODY_ATTRIBUTE, worldFamily);
    return () => document.body.removeAttribute(WORLD_FAMILY_BODY_ATTRIBUTE);
  }, [worldFamily]);

  function toggleCollapse() {
    setCollapseState(toggleFormRailCollapseState);
    // Safari does not focus a button on click, which would leave focus on <body>
    // and restart the next Tab from the top of the document.
    toggleButtonReference.current?.focus();
  }

  return { collapseState, toggleCollapse, toggleButtonReference };
}

type WorldChromeToggleProps = {
  isExpanded: boolean;
  onToggle: () => void;
  /** The id of the region this controls, for `aria-controls`. */
  controlsElementId: string;
  noun: WorldChromeNoun;
  /**
   * `| null` because React 19 types `useRef<T>(null)` as
   * `RefObject<T | null>` — the ref genuinely is null until the element
   * mounts, and 18's types simply lied about it. Widening the prop is the
   * honest fix; narrowing at the call site would be re-telling the lie.
   */
  buttonReference: React.RefObject<HTMLButtonElement | null>;
  disabled?: boolean;
};

export function WorldChromeToggle({
  isExpanded,
  onToggle,
  controlsElementId,
  noun,
  buttonReference,
  disabled = false
}: WorldChromeToggleProps) {
  return (
    // It docks in the header's own band and above the header, so it keeps one
    // place whether the header is present or has left. It cannot simply outrank
    // the header with a z-index — app/template.tsx wraps every page in an
    // opacity animation, which creates a stacking context — so the header is
    // pointer-transparent instead; see the comment in app/layout.tsx.
    <div className="chrome-toggle-dock pointer-events-none absolute inset-x-0 z-[60] flex justify-center">
      <button
        ref={buttonReference}
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-expanded={isExpanded}
        aria-controls={controlsElementId}
        aria-label={worldChromeToggleAccessibleLabel(noun)}
        className="chrome-toggle focus-ring pointer-events-auto text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45"
      >
        <span className="chrome-toggle-icon">
          {isExpanded ? (
            <PanelLeftClose className="h-5 w-5" aria-hidden="true" />
          ) : (
            <PanelLeftOpen className="h-5 w-5" aria-hidden="true" />
          )}
        </span>
        {/* The label unrolls only when pointed at, so the resting screen is
            world and nothing else. It is aria-hidden because the button already
            carries a stable accessible name that does not depend on it. */}
        <span className="chrome-toggle-label" aria-hidden="true">
          <span className="chrome-toggle-label-text">{formRailToggleLabel(isExpanded, noun)}</span>
        </span>
      </button>
    </div>
  );
}
