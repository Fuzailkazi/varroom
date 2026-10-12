import { CaretDown, CaretUp } from "@phosphor-icons/react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export type DecisionVerdict =
  | "DECISION_STANDS"
  | "CONFIRMED"
  | "UPHELD"
  | "OVERTURNED"
  | "CHECK_INCOMPLETE"
  | "INCONCLUSIVE"
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
  const [isExpanded, setIsExpanded] = useState(false);

  const normalized =
    verdict === "CONFIRMED" || verdict === "UPHELD"
      ? "DECISION_STANDS"
      : verdict === "INCONCLUSIVE"
        ? "CHECK_INCOMPLETE"
        : verdict;

  const config = {
    DECISION_STANDS: {
      stampText: "DECISION STANDS",
      stampClass: "bg-[var(--lime)] text-[var(--on-lime)] -rotate-1 border-[var(--ink)]",
      scoreColor: "text-[var(--on-lime)]",
      takeaway: "Decision Stands. Group Chat Vindication Granted.",
      sub: "We checked the numbers twice: your tactical intuition is fully backed by match event data.",
      bg: "bg-[var(--surface)]",
    },
    OVERTURNED: {
      stampText: "OVERTURNED",
      stampClass: "bg-[var(--danger-soft)] text-[var(--danger)] border-[var(--danger)] rotate-1",
      scoreColor: "text-[var(--danger)]",
      takeaway: "Decision Overturned. Sent Off for Simulated xG.",
      sub: "Your take, reviewed. The tracking data and match event logs directly contradict this premise.",
      bg: "bg-[var(--surface)]",
    },
    CHECK_INCOMPLETE: {
      stampText: "CHECK INCOMPLETE",
      stampClass: "bg-[var(--warning-soft)] text-[var(--warning)] border-[var(--warning)]",
      scoreColor: "text-[var(--warning)]",
      takeaway: "Check Incomplete. Stop Crowding the Referee.",
      sub: "We checked available footage and event feeds; insufficient samples exist to rule cleanly.",
      bg: "bg-[var(--surface)]",
    },
    IN_PROGRESS: {
      stampText: "LIVE VAR CHECK",
      stampClass: "bg-[var(--violet-soft)] text-[var(--violet)] border-[var(--violet)]",
      scoreColor: "text-[var(--violet)]",
      takeaway: "Referee Summoned to Pitchside Monitor.",
      sub: "Splitting your take into claims and querying real match event logs.",
      bg: "bg-[var(--surface)]",
    },
  }[normalized] || {
    stampText: "VAR REVIEW",
    stampClass: "bg-[var(--sunken)] text-[var(--ink)] border-[var(--ink)]",
    scoreColor: "text-[var(--ink)]",
    takeaway: "Official Match Review",
    sub: "Your take, reviewed.",
    bg: "bg-[var(--surface)]",
  };

  return (
    <div
      className={cn(
        "rounded-md border-[var(--border-w)] border-[var(--ink)] shadow-hard p-5 sm:p-6 transition-all duration-150",
        config.bg,
        className,
      )}
    >
      {/* Header: Stamp + Score */}
      <div className="flex items-start justify-between gap-4 flex-wrap pb-3">
        <div>
          <div className="font-mono text-[11px] font-bold text-[var(--ink-3)] uppercase tracking-wider mb-2">
            VAR ADJUDICATION {confidence ? `· ${confidence}` : ""}
          </div>
          <span
            className={cn(
              "inline-flex items-center font-display font-extrabold text-base tracking-wide uppercase px-4 py-1.5 rounded-pill border-[var(--border-w-bold)] shadow-hard select-none",
              config.stampClass,
            )}
          >
            {config.stampText}
          </span>
        </div>

        {score !== undefined && score !== null && (
          <div className="text-right shrink-0">
            <div
              className={cn(
                "font-display font-extrabold text-4xl sm:text-5xl leading-none tracking-tight",
                config.scoreColor,
              )}
            >
              {score}
            </div>
            <div className="font-mono text-xs font-bold text-[var(--ink-3)] mt-0.5">
              / 100 CREDIBILITY
            </div>
          </div>
        )}
      </div>

      {/* Sassy Takeaway & Subtitle */}
      <div className="pt-2">
        <h2 className="font-display font-extrabold text-xl sm:text-2xl tracking-tight leading-snug text-[var(--ink)]">
          {config.takeaway}
        </h2>
        <p className="mt-1 text-sm sm:text-base text-[var(--ink-2)] font-sans leading-relaxed">
          {config.sub}
        </p>
      </div>

      {/* Expandable Match Report */}
      {reasoning && (
        <div className="mt-4 pt-3 border-t border-[var(--line)]">
          <div
            className={cn(
              "text-sm font-sans text-[var(--ink-2)] leading-relaxed",
              !isExpanded && "line-clamp-2",
            )}
          >
            {reasoning}
          </div>
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="mt-2 inline-flex items-center gap-1 font-sans text-xs font-bold text-[var(--ink)] hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lime)] rounded"
          >
            {isExpanded ? (
              <>
                Hide match notes <CaretUp className="h-3 w-3" />
              </>
            ) : (
              <>
                Read match notes <CaretDown className="h-3 w-3" />
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
