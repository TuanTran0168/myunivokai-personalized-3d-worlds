import type { WorldFamily } from "./types";

/**
 * Family-aware route building, in ONE place.
 *
 * Share pages are SYMMETRIC: every family sits under its own prefix,
 * /universe/share/worlds/{slug}, /nature/share/worlds/{slug} and
 * /ocean/share/worlds/{slug}. Universe used to be un-prefixed, which made the
 * families inconsistent and meant the deploy guide's PUBLIC_WEB_URL differed in
 * shape between services.
 *
 * The old un-prefixed /share/worlds/{slug} route was removed outright (owner
 * decision: pre-existing share links are not worth carrying). Each service's
 * PUBLIC_WEB_URL must therefore carry its family prefix, or the shareUrl it
 * prints will 404.
 *
 * World pages still use a query parameter rather than a prefix, because that
 * path is reached from inside the app rather than from a stored backend URL.
 */

export const WORLD_FAMILY_QUERY_PARAMETER = "family";

// Universe is the default family and the only one whose world page carries no
// query parameter, so it is absent here on purpose: this set is "the families
// that have to say who they are".
const PREFIXED_WORLD_FAMILIES: readonly WorldFamily[] = ["nature", "ocean"];

export function worldFamilyFromQueryValue(value: string | null | undefined): WorldFamily {
  const family = PREFIXED_WORLD_FAMILIES.find((candidate) => candidate === value);
  return family ?? "universe";
}

export function worldPagePath(worldIdentifier: string, family: WorldFamily): string {
  const basePath = `/worlds/${encodeURIComponent(worldIdentifier)}`;
  return family === "universe" ? basePath : `${basePath}?${WORLD_FAMILY_QUERY_PARAMETER}=${family}`;
}

export function sharePagePath(shareSlug: string, family: WorldFamily): string {
  return `/${family}/share/worlds/${encodeURIComponent(shareSlug)}`;
}
