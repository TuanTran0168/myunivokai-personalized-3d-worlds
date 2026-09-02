import type { Metadata } from "next";
import { ShareWorldView } from "@/features/share/ShareWorldView";
import { buildShareWorldMetadata } from "@/features/share/shareWorldMetadata";

// The forest twin of /universe/share/worlds/[shareSlug]: same view component,
// nature backend. nature-service's PUBLIC_WEB_URL carries the /nature prefix,
// so the shareUrl it prints lands exactly here.

// See the universe twin for why `params` is a Promise here on Next 14.
type PageProps = {
  params: Promise<{
    shareSlug: string;
  }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { shareSlug } = await params;
  return buildShareWorldMetadata("nature", shareSlug);
}

export default async function NatureShareWorldPage({ params }: PageProps) {
  const { shareSlug } = await params;
  return <ShareWorldView shareSlug={shareSlug} family="nature" />;
}
