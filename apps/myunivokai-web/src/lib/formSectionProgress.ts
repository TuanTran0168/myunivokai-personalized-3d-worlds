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
