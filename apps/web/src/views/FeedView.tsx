import { ArrowRight, FunnelSimple } from "@phosphor-icons/react";
import { useState } from "react";
import { DebateCard } from "@/components/debates/debate-card";
import { Button } from "@/components/ui/button";
import { useDebates } from "@/lib/use-debates";

type Filter = "all" | "overturned" | "stands" | "incomplete";
const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "All takes" },
  { value: "overturned", label: "Overturned" },
  { value: "stands", label: "Decision stands" },
  { value: "incomplete", label: "Incomplete" },
];

export function FeedView({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const { items, loading, error } = useDebates(24);
  const visible = items.filter((item) => {
    const review = item.latestReview;
    if (filter === "all") return true;
    if (filter === "overturned") return review?.decision === "OVERTURNED";
    if (filter === "stands") return review?.decision === "CONFIRMED";
    return review?.status === "FAILED" || review?.decision === "INCONCLUSIVE";
  });

  return (
    <main className="mx-auto max-w-[1180px] px-4 pb-20 pt-8 sm:px-6 lg:px-8">
      <header className="feed-header">
        <div className="eyebrow text-[var(--lime)]">
          <span className="live-dot" /> THE COMMUNITY BOARD
        </div>
        <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="font-display text-[clamp(3rem,7vw,5.8rem)] font-extrabold leading-[.95] tracking-[-.055em] text-white">
              The football
              <br />
              conversation.
            </h1>
            <p className="mt-5 max-w-lg text-[var(--hero-muted)]">
              Opinions on the record. Decisions backed by evidence. Explore what fans are putting to
              the test.
            </p>
          </div>
          <Button onClick={() => onNavigate("/")} size="lg">
            Post your take <ArrowRight size={18} />
          </Button>
        </div>
      </header>
      <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-5">
        <div>
          <span className="eyebrow text-[var(--ink-3)]">
            <FunnelSimple size={15} weight="bold" /> FILTER THE BOARD
          </span>
          <p className="mt-1 text-sm text-[var(--ink-2)]">
            {loading
              ? "Loading…"
              : `${visible.length} ${visible.length === 1 ? "take" : "takes"} shown`}
          </p>
        </div>
        <fieldset className="flex max-w-full gap-2 overflow-x-auto pb-1">
          <legend className="sr-only">Filter decisions</legend>
          {filters.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={`filter-pill ${filter === value ? "is-active" : ""}`}
            >
              {label}
            </button>
          ))}
        </fieldset>
      </div>
      {loading ? (
        <p className="feed-message mt-6">Loading the board…</p>
      ) : error ? (
        <p role="status" className="feed-message mt-6">
          {error}
        </p>
      ) : visible.length === 0 ? (
        <p className="feed-message mt-6">No takes in this category yet.</p>
      ) : (
        <section aria-label="Football takes" className="mt-6 grid gap-4 md:grid-cols-2">
          {visible.map((item) => (
            <DebateCard key={item.id} debate={item} onNavigate={onNavigate} />
          ))}
        </section>
      )}
    </main>
  );
}
