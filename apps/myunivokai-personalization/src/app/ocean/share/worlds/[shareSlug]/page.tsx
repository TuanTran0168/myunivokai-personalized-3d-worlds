import type { Metadata } from "next";
import { ShareWorldView } from "@/features/share/ShareWorldView";
import { buildShareWorldMetadata } from "@/features/share/shareWorldMetadata";

// The ocean twin of /universe/share/worlds/[shareSlug] and
// /nature/share/worlds/[shareSlug]: same view component, ocean backend.
// ocean-service's PUBLIC_WEB_URL carries the /ocean prefix, so the shareUrl it
// prints lands exactly here.

// See the universe twin for why `params` is a Promise.
type PageProps = {
  params: Promise<{
    shareSlug: string;
  }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { shareSlug } = await params;
  return buildShareWorldMetadata("ocean", shareSlug);
}

export default async function OceanShareWorldPage({ params }: PageProps) {
  const { shareSlug } = await params;
  return <ShareWorldView shareSlug={shareSlug} family="ocean" />;
}
