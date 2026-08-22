import type { Metadata } from "next";
import type { WorldFamily } from "@/lib/types";
import { apiBaseUrlForFamily } from "@/lib/gateway";

// Server-side metadata for the share pages, shared by every family so the two
// routes cannot drift apart (they were near-identical copies before).

// Social crawlers read metadata server-side; cache it so a popular share link
// does not hammer the API, and bail out fast when the API is cold so the page
// itself never waits on a slow metadata fetch.
const METADATA_REVALIDATE_SECONDS = 300;
const METADATA_FETCH_TIMEOUT_MILLISECONDS = 3000;

type ShareWorldMetadataPayload = {
  world?: {
    nickname?: string;
    archetype?: string;
    sceneName?: string;
    quote?: string;
    shortNarrative?: string;
  };
};

type FamilyCopy = {
  fallbackTitle: string;
  fallbackDescription: string;
  /** Used when the world has no scene name of its own. */
  genericSceneName: string;
};

const COPY_BY_FAMILY: Record<WorldFamily, FamilyCopy> = {
  universe: {
    fallbackTitle: "A personal universe — Myunivokai",
    fallbackDescription:
      "A one-of-a-kind 3D universe generated from a personality. Explore it, then create your own.",
    genericSceneName: "A personal universe"
  },
  nature: {
    fallbackTitle: "A personal forest — Myunivokai",
    fallbackDescription:
      "A one-of-a-kind living 3D forest generated from a personality. Explore it, then create your own.",
    genericSceneName: "A personal forest"
  },
  ocean: {
    fallbackTitle: "A personal sea — Myunivokai",
    fallbackDescription:
      "A one-of-a-kind 3D sea generated from a personality — reef, twilight or abyss. Explore it, then create your own.",
    genericSceneName: "A personal sea"
  }
};

async function fetchShareWorldForMetadata(
  family: WorldFamily,
  shareSlug: string
): Promise<ShareWorldMetadataPayload | null> {
  try {
    const response = await fetch(
      `${apiBaseUrlForFamily(family)}/share/worlds/${encodeURIComponent(shareSlug)}`,
      {
        next: { revalidate: METADATA_REVALIDATE_SECONDS },
        signal: AbortSignal.timeout(METADATA_FETCH_TIMEOUT_MILLISECONDS)
      }
    );
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as ShareWorldMetadataPayload;
  } catch {
    // Metadata is a bonus, never a blocker: an unreachable or cold API just
    // means the crawler sees the fallback copy.
    return null;
  }
}

export async function buildShareWorldMetadata(family: WorldFamily, shareSlug: string): Promise<Metadata> {
  const copy = COPY_BY_FAMILY[family];
  const payload = await fetchShareWorldForMetadata(family, shareSlug);
  const world = payload?.world;
  if (!world) {
    return { title: copy.fallbackTitle, description: copy.fallbackDescription };
  }

  const pageTitle = `${world.sceneName || copy.genericSceneName} — Myunivokai`;
  const portraitLine = world.nickname
    ? `A portrait of ${world.nickname}${world.archetype ? `, ${world.archetype}` : ""}.`
    : "";
  const pageDescription =
    [world.quote, world.shortNarrative, portraitLine].filter(Boolean).join(" ") || copy.fallbackDescription;

  return {
    title: pageTitle,
    description: pageDescription,
    openGraph: {
      title: pageTitle,
      description: pageDescription,
      siteName: "Myunivokai",
      type: "website"
    },
    twitter: {
      card: "summary",
      title: pageTitle,
      description: pageDescription
    }
  };
}
