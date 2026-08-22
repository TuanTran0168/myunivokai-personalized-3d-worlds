import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "../format";
import type { WorldDetail } from "../types";

// The identity half of the world detail page: what this world is, and the four
// ids that connect it to the rest of the platform. Kept out of the page so the
// page reads as a list of sections rather than 120 lines of <dl>.
export function WorldIdentityCard({ world }: { world: WorldDetail["world"] }) {
  return (
    <Card>
      <CardContent className="pt-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="capitalize">
            {world.family}
          </Badge>
          <Badge variant="ghost">{world.worldStyle}</Badge>
          <Badge variant="ghost">{world.mood}</Badge>
          {world.role ? <Badge variant="ghost">{world.role}</Badge> : null}
          {world.isPublished ? <Badge variant="default">Public</Badge> : <Badge variant="secondary">Private</Badge>}
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Variants" value={`${world.selectedVariantNo} of ${world.variantCount} selected`} />
          <Field label="Created" value={formatDateTime(world.worldCreatedAt)} />
          <Field label="Published" value={formatDateTime(world.publishedAt)} />
          <Field label="Projected" value={formatDateTime(world.projectedAt)} />
          <Field label="Revision" value={String(world.revision)} />
          <Field label="World id" value={world.worldId} mono />
          <Field label="Profile id" value={world.profileId} mono />
          <Field label="DNA version id" value={world.dnaVersionId} mono />
          <Field label="Source job id" value={world.sourceJobId} mono />
        </dl>
      </CardContent>
    </Card>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "truncate font-mono text-xs text-foreground" : "text-sm text-foreground"}>{value}</dd>
    </div>
  );
}
