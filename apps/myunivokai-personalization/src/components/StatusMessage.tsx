import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { SweepRail } from "@/components/SweepRail";

type StatusMessageProps = {
  tone?: "error" | "success" | "loading";
  children: ReactNode;
};

export function StatusMessage({ tone = "success", children }: StatusMessageProps) {
  // A wait is not a message with an icon on it, so the loading tone is not
  // built like one. The spinning Loader2 that used to sit here said nothing
  // except that time was passing; what replaces it is the label set in the same
  // mono caps the scene title cards use, over a rail that sweeps the way a
  // phone brings the next screen in. Same call sites, same words — the wait
  // simply stopped fidgeting and started reading as part of the product.
  if (tone === "loading") {
    return (
      <div
        role="status"
        className="grid w-full max-w-xs gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-3.5"
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-brass/90">{children}</span>
        <SweepRail />
      </div>
    );
  }

  const styles = {
    error: "border-error/30 bg-error-container/25 text-on-surface",
    success: "border-secondary/25 bg-secondary/10 text-on-surface"
  };
  const Icon = tone === "error" ? AlertCircle : CheckCircle2;

  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${styles[tone]}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
