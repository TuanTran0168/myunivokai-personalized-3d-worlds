import Link from "next/link";
import { Images, Sparkles, type LucideIcon } from "lucide-react";
import { returnDestinationsFrom, type ReturnDestinationKind } from "@/lib/returnDestinations";

/**
 * An icon per destination, keyed by the destination's own `kind` rather than by
 * its href. Exhaustive on the union, so adding a third way out cannot ship a
 * link with no icon.
 */
const DESTINATION_ICONS: Record<ReturnDestinationKind, LucideIcon> = {
  // The create form is where a world is made, not a house you return to.
  personalization: Sparkles,
  gallery: Images
};

/**
 * How the same two links are dressed in the two places they appear.
 *
 * `control` is a real button, sitting in a form's footer beside the one that
 * commits it. `notice` is the compact pair inside a toast, where the message
 * above them is already carrying the emphasis and a second row of filled
 * buttons would fight it.
 */
export type ReturnDestinationPresentation = "control" | "notice";

const PRESENTATION_CLASSES: Record<ReturnDestinationPresentation, string> = {
  control:
    "focus-ring inline-flex items-center gap-2 rounded-xl border border-hairline bg-black/30 px-4 py-2.5 font-semibold text-on-surface transition hover:border-brass/60 hover:text-paper",
  notice:
    "focus-ring inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold text-secondary transition hover:bg-white/5"
};

const ICON_CLASSES: Record<ReturnDestinationPresentation, string> = {
  control: "h-4 w-4",
  notice: "h-3.5 w-3.5"
};

type ReturnDestinationLinksProps = {
  /** The route these links are being shown on. It is never offered back. */
  currentPath: string;
  presentation: ReturnDestinationPresentation;
  /** Runs before the navigation — a menu or a toast closing itself. */
  onNavigate?: () => void;
};

/**
 * The ways out of wherever this is rendered, minus the page it is rendered on.
 *
 * Renders nothing when there is nowhere to go, which is a real state rather
 * than a defensive check: it is what a future third screen would produce, and
 * an empty row of padding under a message is worse than no row.
 */
export function ReturnDestinationLinks({ currentPath, presentation, onNavigate }: ReturnDestinationLinksProps) {
  const destinations = returnDestinationsFrom(currentPath);
  if (destinations.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {destinations.map((destination) => {
        const DestinationIcon = DESTINATION_ICONS[destination.kind];
        return (
          <Link
            key={destination.kind}
            href={destination.href}
            onClick={onNavigate}
            className={PRESENTATION_CLASSES[presentation]}
          >
            <DestinationIcon className={ICON_CLASSES[presentation]} aria-hidden="true" />
            {destination.label}
          </Link>
        );
      })}
    </div>
  );
}
