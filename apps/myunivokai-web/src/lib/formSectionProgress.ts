/**
 * Picks which create-form section counts as "active" for the rail's scroll
 * position indicator, extracted from app/page.tsx so the picking rule can be
 * locked by tests independently of IntersectionObserver (jsdom does not
 * implement it, so the callback's own logic has to be testable without it).
 */

export type SectionVisibility = {
  id: string;
  /** IntersectionObserverEntry.intersectionRatio, or an equivalent 0-1 value. */
  intersectionRatio: number;
};

/**
 * The most-visible section wins; a section that has left the observer's root
 * margin entirely (ratio 0) never wins. Ties keep whichever section is
 * currently active, so a dead-even split does not flicker between two
 * neighbors every frame.
 *
 * Returns `currentActiveId` unchanged when nothing is visible at all — between
 * two sections' margins is not a state the indicator should visibly collapse
 * out of.
 */
export function pickActiveSectionId(
  visibilities: SectionVisibility[],
  currentActiveId: string | null
): string | null {
  let winner: SectionVisibility | null = null;
  for (const visibility of visibilities) {
    if (visibility.intersectionRatio <= 0) {
      continue;
    }
    if (
      !winner ||
      visibility.intersectionRatio > winner.intersectionRatio ||
      (visibility.intersectionRatio === winner.intersectionRatio && visibility.id === currentActiveId)
    ) {
      winner = visibility;
    }
  }
  return winner ? winner.id : currentActiveId;
}

/** The active section's position for the segmented indicator, 0 when unknown. */
export function activeSectionIndex(sectionIds: readonly string[], activeId: string | null): number {
  if (!activeId) {
    return 0;
  }
  const index = sectionIds.indexOf(activeId);
  return index === -1 ? 0 : index;
}

/**
 * How close to the bottom of the field column still counts as "at the bottom".
 * A scrollport's own `scrollTop` is fractional on a zoomed or high-DPI display,
 * so an exact equality never fires there.
 */
export const SCROLL_END_TOLERANCE_PIXELS = 2;

export type ScrollPosition = {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
};

/** True once the field column cannot scroll any further down. */
export function isScrolledToEnd(position: ScrollPosition): boolean {
  return position.scrollTop + position.clientHeight >= position.scrollHeight - SCROLL_END_TOLERANCE_PIXELS;
}

/**
 * The active section as the indicator should show it, which is not quite the
 * most-visible one.
 *
 * The observer's band sits a fifth of the way down the field column, so the
 * LAST section can never enter it: at maximum scroll it is pinned to the bottom
 * of the scrollport, below the band, and something above it wins forever. The
 * indicator would stop one segment short of full no matter how far the visitor
 * scrolled — which reads as a broken bar rather than as a finished form.
 *
 * Reaching the bottom of the scroll is therefore its own signal, and it
 * outranks the band.
 */
export function resolveActiveSectionId(
  sectionIds: readonly string[],
  visibilities: SectionVisibility[],
  currentActiveId: string | null,
  hasReachedEnd: boolean
): string | null {
  if (hasReachedEnd && sectionIds.length > 0) {
    return sectionIds[sectionIds.length - 1];
  }
  return pickActiveSectionId(visibilities, currentActiveId);
}
