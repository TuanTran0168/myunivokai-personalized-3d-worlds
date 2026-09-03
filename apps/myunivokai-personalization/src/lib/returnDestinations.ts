/**
 * The two places a person is ever sent back to, declared once.
 *
 * There are exactly two screens in this app that are somebody's own: the
 * create-world form, which the owner calls their personalization, and the
 * gallery. Every "you are finished here" moment — a saved profile, a world
 * that came out of the presets — offers those two and nothing else.
 *
 * Written here rather than at each call site because the pair had already
 * drifted: the profile page's footer link and the copy of it inside its own
 * confirmation toast both said "Back to your worlds" and both went to the
 * gallery, and neither offered the create form at all.
 */
/**
 * Which of the two it is, carried as a value rather than inferred from the
 * href. It is what lets the component that renders these pick an icon from a
 * `Record<ReturnDestinationKind, …>` — exhaustive, so a third destination added
 * here is a compile error there instead of a link with no icon.
 */
export type ReturnDestinationKind = "personalization" | "gallery";

export type ReturnDestination = {
  kind: ReturnDestinationKind;
  href: string;
  label: string;
};

export const PERSONALIZATION_DESTINATION: ReturnDestination = {
  kind: "personalization",
  href: "/",
  label: "Back to your personalization"
};

export const GALLERY_DESTINATION: ReturnDestination = {
  kind: "gallery",
  href: "/gallery",
  label: "Back to your gallery"
};

/** In the order they are offered: make one, then look at what you made. */
const RETURN_DESTINATIONS: readonly ReturnDestination[] = [PERSONALIZATION_DESTINATION, GALLERY_DESTINATION];

/**
 * The destinations worth offering from `currentPath`, which is every one of
 * them except the page already being looked at.
 *
 * The filter is the whole point of this function. The gallery's own confirmation
 * toasts and the create page's generation notice both live on a screen that is
 * itself one of these two, and a toast whose only action reloads the page it is
 * sitting on is worse than a toast with no action — it looks like a way out and
 * is not one.
 */
export function returnDestinationsFrom(currentPath: string): ReturnDestination[] {
  const normalizedCurrentPath = normalizePath(currentPath);
  return RETURN_DESTINATIONS.filter((destination) => normalizePath(destination.href) !== normalizedCurrentPath);
}

/**
 * Compares paths the way a router does: the query string and the hash are not
 * part of which page this is, and `/gallery/` is `/gallery`.
 *
 * The root path is the one that cannot lose its slash, so it is returned as
 * itself rather than as the empty string a plain trim would leave.
 */
function normalizePath(path: string): string {
  const pathWithoutQuery = path.split("?")[0].split("#")[0];
  const trimmedPath = pathWithoutQuery.replace(/\/+$/, "");
  return trimmedPath === "" ? "/" : trimmedPath;
}
