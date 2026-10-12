import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

interface FeedItem {
  id: string;
  reviewId?: string;
  statement: string;
  decision: "OVERTURNED" | "DECISION_STANDS" | "CHECK_INCOMPLETE" | "LIVE";
  score: number | null;
  timeAgo: string;
  meta: string;
}

const FALLBACK_FEED: FeedItem[] = [
  {
    id: "f-1",
    reviewId: "8c4a4564-7382-4c27-93b0-742e0907d245",
    statement:
      "Bellingham is twice the player when deployed as an 8 rather than an isolated false 9.",
    decision: "OVERTURNED",
    score: 24,
    timeAgo: "8m ago",
    meta: "3 claims checked · Real Madrid vs Real Betis",
  },
  {
    id: "f-2",
    reviewId: "5abdc9a4-66c3-42c6-98ee-3fe002c299df",
    statement: "Arsenal's near-post corner block routines are completely legal under Law 12.",
    decision: "DECISION_STANDS",
    score: 92,
    timeAgo: "24m ago",
    meta: "4 claims checked · Arsenal vs Man City",
  },
  {
    id: "f-3",
    reviewId: "6c0ac1ef-bc3d-4d2d-b5a5-c4455a8a6c0c",
    statement: "Vinícius was tripped before falling in the 74th minute penalty claim.",
    decision: "CHECK_INCOMPLETE",
    score: 51,
    timeAgo: "1h ago",
    meta: "2 claims checked · Real Madrid vs Real Sociedad",
  },
  {
    id: "f-4",
    statement:
      "Haaland’s 11 touches per 90 makes City vulnerable against Champions League transitions.",
    decision: "LIVE",
    score: null,
    timeAgo: "3m ago",
    meta: "Splitting claims · Checking claim 2 of 4",
  },
  {
    id: "f-5",
    reviewId: "8c4a4564-7382-4c27-93b0-742e0907d245",
    statement: "Guardiola overthinks big Champions League knockout ties.",
    decision: "OVERTURNED",
    score: 18,
    timeAgo: "2h ago",
    meta: "4 claims checked · Man City vs Real Madrid",
  },
  {
    id: "f-6",
    reviewId: "5abdc9a4-66c3-42c6-98ee-3fe002c299df",
    statement: "Pedri is best deployed as a left-sided central eight rather than an advanced ten.",
    decision: "DECISION_STANDS",
    score: 100,
    timeAgo: "3h ago",
    meta: "2 claims checked · Barcelona vs Girona",
  },
];

interface FeedViewProps {
  onNavigate: (path: string) => void;
}

export function FeedView({ onNavigate }: FeedViewProps) {
  const [filter, setFilter] = useState<"all" | "overturned" | "stands" | "incomplete">("all");
  const [feedItems, setFeedItems] = useState<FeedItem[]>(FALLBACK_FEED);

  useEffect(() => {
    async function loadFeed() {
      try {
        const res = await fetch("/api/debates?limit=12");
        if (!res.ok) return;
        const data = await res.json();
        if (data.items && data.items.length > 0) {
          const mapped: FeedItem[] = data.items.map((item: any, idx: number) => {
            const review = item.latestReview;
            let decision: FeedItem["decision"] = "CHECK_INCOMPLETE";
            if (review) {
              if (review.status === "RUNNING" || review.status === "PENDING") {
                decision = "LIVE";
              } else if (review.decision === "OVERTURNED") {
                decision = "OVERTURNED";
              } else if (review.decision === "CONFIRMED" || review.decision === "UPHELD") {
                decision = "DECISION_STANDS";
              }
            }
            return {
              id: item.id,
              reviewId: review ? review.id : undefined,
              statement: item.thesis || item.title,
              decision,
              score: review ? review.credibilityScore : null,
              timeAgo: `${(idx + 1) * 11}m ago`,
              meta: review
                ? review.summary || "Full adjudication report"
                : "Awaiting referee review",
            };
          });
          setFeedItems(mapped);
        }
      } catch {
        // Fall back to demo list
      }
    }

    loadFeed();
  }, []);

  const filtered = feedItems.filter((item) => {
    if (filter === "all") return true;
    if (filter === "overturned") return item.decision === "OVERTURNED";
    if (filter === "stands") return item.decision === "DECISION_STANDS";
    if (filter === "incomplete")
      return item.decision === "CHECK_INCOMPLETE" || item.decision === "LIVE";
    return true;
  });

  return (
    <main>
      <header className="mb-6">
        <h1 className="font-display font-extrabold text-[clamp(28px,4.5vw,36px)] leading-[1.05] tracking-tight text-[var(--ink)] mb-1">
          Community Feed
        </h1>
        <p className="font-sans text-sm text-[var(--ink-2)] mb-4">
          Every fan opinion submitted and judged against real match event data.
        </p>

        {/* ONE FILTER AT MOST: Clean segmented pills */}
        <div className="flex gap-2 overflow-x-auto pb-1 select-none">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`font-sans font-bold text-xs sm:text-sm px-4 py-1.5 rounded-pill border-[var(--border-w)] border-[var(--ink)] cursor-pointer transition-all ${
              filter === "all"
                ? "bg-[var(--lime)] text-[var(--on-lime)] shadow-hard"
                : "bg-[var(--surface)] text-[var(--ink)] shadow-collapse hover:bg-[var(--sunken)]"
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setFilter("overturned")}
            className={`font-sans font-bold text-xs sm:text-sm px-4 py-1.5 rounded-pill border-[var(--border-w)] border-[var(--ink)] cursor-pointer transition-all ${
              filter === "overturned"
                ? "bg-[var(--lime)] text-[var(--on-lime)] shadow-hard"
                : "bg-[var(--surface)] text-[var(--ink)] shadow-collapse hover:bg-[var(--sunken)]"
            }`}
          >
            Overturned
          </button>
          <button
            type="button"
            onClick={() => setFilter("stands")}
            className={`font-sans font-bold text-xs sm:text-sm px-4 py-1.5 rounded-pill border-[var(--border-w)] border-[var(--ink)] cursor-pointer transition-all ${
              filter === "stands"
                ? "bg-[var(--lime)] text-[var(--on-lime)] shadow-hard"
                : "bg-[var(--surface)] text-[var(--ink)] shadow-collapse hover:bg-[var(--sunken)]"
            }`}
          >
            Decision stands
          </button>
          <button
            type="button"
            onClick={() => setFilter("incomplete")}
            className={`font-sans font-bold text-xs sm:text-sm px-4 py-1.5 rounded-pill border-[var(--border-w)] border-[var(--ink)] cursor-pointer transition-all ${
              filter === "incomplete"
                ? "bg-[var(--lime)] text-[var(--on-lime)] shadow-hard"
                : "bg-[var(--surface)] text-[var(--ink)] shadow-collapse hover:bg-[var(--sunken)]"
            }`}
          >
            Incomplete
          </button>
        </div>
      </header>

      {/* SINGLE COLUMN FEED LIST */}
      <section className="flex flex-col gap-3.5">
        {filtered.map((item) => {
          const isLive = item.decision === "LIVE";
          const reviewTarget = item.reviewId
            ? `/review/${item.reviewId}`
            : `/review?take=${encodeURIComponent(item.statement)}${isLive ? "&running=true" : ""}`;

          return (
            <a
              href={reviewTarget}
              key={item.id}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(reviewTarget);
              }}
              className="bg-[var(--surface)] border-[var(--border-w)] border-[var(--ink)] rounded-md shadow-hard p-5 cursor-pointer select-none transition-all duration-100 hover:shadow-hard-lg hover:-translate-x-[1px] hover:-translate-y-[1px] active:translate-x-[2px] active:translate-y-[2px] active:shadow-collapse focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lime)]"
            >
              <div className="flex justify-between items-center gap-2 mb-2">
                {item.decision === "OVERTURNED" && <Badge variant="overturned">OVERTURNED</Badge>}
                {item.decision === "DECISION_STANDS" && (
                  <Badge variant="stands">DECISION STANDS</Badge>
                )}
                {item.decision === "CHECK_INCOMPLETE" && (
                  <Badge variant="incomplete">CHECK INCOMPLETE</Badge>
                )}
                {item.decision === "LIVE" && <Badge variant="live">CHECKING NOW...</Badge>}

                <span
                  className="font-mono font-bold text-xs sm:text-sm"
                  style={{
                    color:
                      item.decision === "OVERTURNED"
                        ? "var(--danger)"
                        : item.decision === "DECISION_STANDS"
                          ? "var(--on-lime)"
                          : item.decision === "LIVE"
                            ? "var(--violet)"
                            : "var(--warning)",
                  }}
                >
                  {item.score !== null ? `${item.score} / 100` : "RUNNING"}
                </span>
              </div>

              <div className="font-bold text-[16px] sm:text-[17px] leading-[1.35] text-[var(--ink)] mb-2">
                “{item.statement}”
              </div>

              <div className="font-sans text-xs text-[var(--ink-3)]">
                {item.timeAgo} · {item.meta}
              </div>
            </a>
          );
        })}
      </section>
    </main>
  );
}
