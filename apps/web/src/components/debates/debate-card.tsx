import { ArrowUpRight, ChatCircle, Clock } from "@phosphor-icons/react";
import type { Debate } from "@varroom/shared";
import { Badge } from "@/components/ui/badge";

function reviewState(debate: Debate) {
  const review = debate.latestReview;
  if (!review) return { label: "Awaiting review", variant: "secondary" as const };
  if (review.status === "QUEUED" || review.status === "RUNNING") {
    return { label: "Checking now", variant: "live" as const };
  }
  if (review.status === "FAILED" || review.decision === "INCONCLUSIVE") {
    return { label: "Check incomplete", variant: "incomplete" as const };
  }
  if (review.decision === "OVERTURNED") {
    return { label: "Overturned", variant: "overturned" as const };
  }
  if (review.decision === "CONFIRMED") {
    return { label: "Decision stands", variant: "stands" as const };
  }
  return { label: "Awaiting review", variant: "secondary" as const };
}

export function DebateCard({
  debate,
  onNavigate,
}: {
  debate: Debate;
  onNavigate: (path: string) => void;
}) {
  const state = reviewState(debate);
  const destination = debate.latestReview ? `/review/${debate.latestReview.id}` : null;
  const date = new Date(debate.createdAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const content = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Badge variant={state.variant}>{state.label}</Badge>
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--ink-3)]">
          {debate.latestReview?.credibilityScore != null
            ? `${debate.latestReview.credibilityScore} / 100`
            : "No score yet"}
        </span>
      </div>
      <div className="mt-4 flex items-start justify-between gap-4">
        <h3 className="line-clamp-3 max-w-[62ch] font-display text-lg font-bold leading-snug tracking-tight text-[var(--ink)] sm:text-xl">
          {debate.thesis}
        </h3>
        {destination && (
          <ArrowUpRight
            className="mt-1 h-5 w-5 shrink-0 text-[var(--ink-3)] transition-transform group-hover:-translate-y-1 group-hover:translate-x-1"
            aria-hidden="true"
          />
        )}
      </div>
      {debate.latestReview?.summary && (
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[var(--ink-2)]">
          {debate.latestReview.summary}
        </p>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--line)] pt-3 text-xs text-[var(--ink-3)]">
        <span className="font-semibold text-[var(--ink-2)]">{debate.author.displayName}</span>
        <span className="inline-flex items-center gap-1">
          <Clock size={13} />
          {date}
        </span>
        <span className="inline-flex items-center gap-1">
          <ChatCircle size={13} />
          {debate.commentCount} comments
        </span>
      </div>
    </>
  );
  if (!destination) return <article className="debate-card">{content}</article>;
  return (
    <a
      href={destination}
      onClick={(event) => {
        event.preventDefault();
        onNavigate(destination);
      }}
      className="debate-card group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lime)]"
    >
      {content}
    </a>
  );
}
