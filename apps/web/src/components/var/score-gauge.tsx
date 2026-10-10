import { cn } from "@/lib/utils";

export interface ScoreGaugeProps {
  score: number; // 0 to 100
  size?: "sm" | "lg";
  showLabel?: boolean;
  className?: string;
}

export function ScoreGauge({
  score,
  size = "lg",
  showLabel = true,
  className,
}: ScoreGaugeProps) {
  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));

  // Calculate discrete active segments (total 20 notches, 5 pts each)
  const activeSegments =
    clampedScore > 0 ? Math.max(1, Math.floor(clampedScore / 5)) : 0;

  let classification = "CONTRADICTED";
  let tierTitle = "Contradicted Take";
  let tierQuote = "Overturned. The numbers do not back this up.";
  let tierColor = "text-[var(--danger)]";
  let barTickClass = "danger";

  if (clampedScore >= 80) {
    classification = "DECISION SUPPORTED";
    tierTitle = "Supported Take";
    tierQuote = "Title contender form. Tactically pristine.";
    tierColor = "text-[var(--on-lime)]";
    barTickClass = "on";
  } else if (clampedScore >= 50) {
    classification = "INCONCLUSIVE";
    tierTitle = "Inconclusive Take";
    tierQuote = "Neither cleanly proven nor disproven.";
    tierColor = "text-[var(--warning)]";
    barTickClass = "warning";
  }

  if (size === "sm") {
    return (
      <div className={cn("inline-flex items-center gap-2", className)}>
        <div className="grid grid-cols-20 gap-[2px] p-1 bg-[var(--sunken)] border border-[var(--ink)] rounded-sm w-36">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-2.5 rounded-[1px] border border-[var(--ink)]/40",
                i < activeSegments
                  ? barTickClass === "on"
                    ? "bg-[var(--lime)]"
                    : barTickClass === "danger"
                    ? "bg-[var(--danger)]"
                    : "bg-[var(--warning)]"
                  : "bg-[var(--paper)]"
              )}
            />
          ))}
        </div>
        <span className="font-mono text-xs font-bold text-[var(--ink)]">
          {clampedScore}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-md border-[var(--border-w)] border-[var(--ink)] bg-[var(--surface)] p-5 sm:p-6 shadow-hard",
        className
      )}
    >
      {/* Header Row: Classification & Numerical Score */}
      <div className="flex items-baseline justify-between pb-3 border-b border-[var(--line)]">
        <div>
          <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--ink-3)] block mb-0.5">
            {classification}
          </span>
          {showLabel && (
            <div
              className={cn(
                "font-display font-extrabold text-2xl sm:text-3xl tracking-tight leading-tight",
                tierColor
              )}
            >
              {tierTitle}
            </div>
          )}
          <p className="text-xs sm:text-sm font-sans text-[var(--ink-2)] mt-0.5">
            "{tierQuote}"
          </p>
        </div>
        <div className="text-right shrink-0">
          <span className="font-display font-extrabold text-3xl sm:text-4xl text-[var(--ink)] tracking-tight">
            {clampedScore}
          </span>
          <span className="font-mono text-xs font-bold text-[var(--ink-3)] ml-1">
            / 100
          </span>
        </div>
      </div>

      {/* Discrete 20-notch Ruled Barometer */}
      <div className="mt-4 grid grid-cols-20 gap-1 p-1.5 bg-[var(--sunken)] border-[var(--border-w)] border-[var(--ink)] rounded-sm">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-5 rounded-[2px] border border-[var(--ink)] transition-colors duration-100",
              i < activeSegments
                ? barTickClass === "on"
                  ? "bg-[var(--lime)]"
                  : barTickClass === "danger"
                  ? "bg-[var(--danger)]"
                  : "bg-[var(--warning)]"
                : "bg-[var(--paper)]"
            )}
          />
        ))}
      </div>

      {/* Barometer Threshold Footnotes */}
      <div className="mt-2.5 flex justify-between font-mono text-[10px] font-bold tracking-wider text-[var(--ink-3)] uppercase">
        <span className="text-[var(--danger)]">0 — 49 Contradicted</span>
        <span className="text-[var(--warning)]">50 — 79 Inconclusive</span>
        <span className="text-[var(--on-lime)]">80 — 100 Supported</span>
      </div>
    </div>
  );
}
