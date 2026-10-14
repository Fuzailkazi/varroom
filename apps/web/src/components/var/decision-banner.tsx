import { cn } from "@/lib/utils";

export type DecisionVerdict =
  | "DECISION_STANDS"
  | "CONFIRMED"
  | "UPHELD"
  | "OVERTURNED"
  | "CHECK_INCOMPLETE"
  | "INCONCLUSIVE"
  | "CONTEXT_REVIEWED"
  | "NOT_CHECKABLE"
  | "IN_PROGRESS";

export interface DecisionBannerProps {
  verdict: DecisionVerdict;
  score?: number | null;
  confidence?: string;
  reasoning?: string;
  className?: string;
}

export function DecisionBanner({
  verdict,
  score,
  confidence,
  reasoning,
  className,
}: DecisionBannerProps) {
  const normalized =
    verdict === "CONFIRMED" || verdict === "UPHELD"
      ? "DECISION_STANDS"
      : verdict === "INCONCLUSIVE"
        ? "CHECK_INCOMPLETE"
        : verdict;
  const details = {
    DECISION_STANDS: {
      label: "Decision stands",
      heading: "The evidence backs this take.",
      tone: "stands",
    },
    OVERTURNED: {
      label: "Overturned",
      heading: "The evidence says otherwise.",
      tone: "overturned",
    },
    CHECK_INCOMPLETE: {
      label: "Check incomplete",
      heading: "No clear ruling yet.",
      tone: "incomplete",
    },
    CONTEXT_REVIEWED: {
      label: "Evidence reviewed",
      heading: "The sources inform this opinion, but cannot prove a single winner.",
      tone: "incomplete",
    },
    NOT_CHECKABLE: {
      label: "No factual ruling",
      heading: "This take has no claim that evidence can settle as written.",
      tone: "incomplete",
    },
    IN_PROGRESS: { label: "Live VAR check", heading: "The review is underway.", tone: "running" },
  }[normalized] || { label: "VAR review", heading: "Review on the record.", tone: "incomplete" };

  return (
    <section
      className={cn("decision-card", `decision-${details.tone}`, className)}
      aria-label="VAR decision"
    >
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <div className="eyebrow text-[var(--ink-3)]">
            VAR / FINAL DECISION {confidence ? `· ${confidence}` : ""}
          </div>
          <div className="mt-3">
            <span className="decision-stamp">{details.label}</span>
          </div>
        </div>
        {score != null && (
          <div className="text-right">
            <div className="font-display text-[clamp(3.3rem,8vw,5.4rem)] font-extrabold leading-none tracking-[-.07em]">
              {score}
            </div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-[.13em] text-[var(--ink-3)]">
              out of 100 credibility
            </div>
          </div>
        )}
      </div>
      <div className="mt-8 border-t border-[var(--line)] pt-6">
        <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          {details.heading}
        </h2>
        {reasoning && (
          <p className="mt-3 max-w-[70ch] text-sm leading-relaxed text-[var(--ink-2)] sm:text-base">
            {reasoning}
          </p>
        )}
      </div>
    </section>
  );
}
