import type { Metadata } from "next";
import { ShareWorldView } from "@/features/share/ShareWorldView";
import { buildShareWorldMetadata } from "@/features/share/shareWorldMetadata";

// The universe share page. It lives under /universe so the two families are
// symmetric (/universe/... and /nature/...) — see lib/worldRoutes.ts. The
// historical un-prefixed /share/worlds/[shareSlug] was removed outright, so
// universe-service's PUBLIC_WEB_URL must carry the /universe prefix.

// `params` is a Promise from Next 15 onward, and awaiting one is legal on 14
// too — which is why this change lands ahead of the version bump rather than
// inside it. See agent-system/evolution/frontend-modernization-research.md#the-15--16-hop.
type PageProps = {
  params: Promise<{
    shareSlug: string;
  }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { shareSlug } = await params;
  return buildShareWorldMetadata("universe", shareSlug);
}

export default async function UniverseShareWorldPage({ params }: PageProps) {
  const { shareSlug } = await params;
  return <ShareWorldView shareSlug={shareSlug} family="universe" />;
}
