import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface DebateItem {
  id: string;
  statement: string;
  decision: "OVERTURNED" | "DECISION_STANDS" | "CHECK_INCOMPLETE" | "LIVE";
  score: number | null;
  timeAgo: string;
  meta: string;
  reviewId?: string;
}

const FALLBACK_DEBATES: DebateItem[] = [
  {
    id: "7462f5fb-d549-44f4-bcc1-54b5f5fd10cf",
    reviewId: "8c4a4564-7382-4c27-93b0-742e0907d245",
    statement:
      "Bellingham is twice the player when deployed as an 8 rather than an isolated false 9.",
    decision: "OVERTURNED",
    score: 24,
    timeAgo: "8m ago",
    meta: "3 claims checked · Real Madrid vs Real Betis",
  },
  {
    id: "0096cd0b-0547-47dc-9e75-db09f0ee5e8d",
    reviewId: "5abdc9a4-66c3-42c6-98ee-3fe002c299df",
    statement: "Arsenal's near-post corner block routines are completely legal under Law 12.",
    decision: "DECISION_STANDS",
    score: 92,
    timeAgo: "24m ago",
    meta: "4 claims checked · Arsenal vs Man City",
  },
  {
    id: "395fb0cd-7442-405e-a45c-226d5da6b7db",
    reviewId: "6c0ac1ef-bc3d-4d2d-b5a5-c4455a8a6c0c",
    statement: "Vinícius was tripped before falling in the 74th minute penalty claim.",
    decision: "CHECK_INCOMPLETE",
    score: 51,
    timeAgo: "1h ago",
    meta: "2 claims checked · Real Madrid vs Real Sociedad",
  },
  {
    id: "haaland-running",
    statement:
      "Haaland’s 11 touches per 90 makes City vulnerable against Champions League transitions.",
    decision: "LIVE",
    score: null,
    timeAgo: "3m ago",
    meta: "Splitting claims · Checking claim 2 of 4",
  },
];

interface HomeViewProps {
  onNavigate: (path: string) => void;
  onSubmitTake: (take: string) => void;
}

export function HomeView({ onNavigate, onSubmitTake }: HomeViewProps) {
  const [takeInput, setTakeInput] = useState(
    "Bellingham is twice the player when deployed as an 8 rather than an isolated false 9.",
  );
  const [debates, setDebates] = useState<DebateItem[]>(FALLBACK_DEBATES);
  const [_loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadRecentDebates() {
      try {
        setLoading(true);
        const res = await fetch("/api/debates?limit=6");
        if (!res.ok) return;
        const data = await res.json();
        if (data.items && data.items.length > 0) {
          const mapped: DebateItem[] = data.items.map((item: any, idx: number) => {
            const review = item.latestReview;
            let decision: DebateItem["decision"] = "CHECK_INCOMPLETE";
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
              timeAgo: `${(idx + 1) * 7}m ago`,
              meta: review
                ? `${review.summary || "Full adjudication on file"}`
                : "Awaiting referee review",
            };
          });
          setDebates(mapped);
        }
      } catch {
        // Use fallback debates if backend unavailable or sleeping
      } finally {
        setLoading(false);
      }
    }

    loadRecentDebates();
  }, []);

  const handleSubmit = (e?: any) => {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    console.log("HomeView handleSubmit called with:", takeInput);
    if (!takeInput.trim()) return;
    onSubmitTake(takeInput.trim());
  };

  return (
    <main>
      {/* PRIMARY ACTION: SINGLE BIG TEXTBOX + ONE BUTTON */}
      <form
        onSubmit={handleSubmit}
        className="rounded-md border-[var(--border-w)] border-[var(--ink)] bg-[var(--surface)] p-6 shadow-hard mb-8 transition-all"
      >
        <label
          htmlFor="takeInput"
          className="block font-display font-extrabold text-[clamp(26px,4.5vw,36px)] leading-[1.05] tracking-tight text-[var(--ink)] mb-3"
        >
          What's your football take?
        </label>
        <textarea
          id="takeInput"
          value={takeInput}
          onChange={(e) => setTakeInput(e.target.value)}
          placeholder="e.g. Bellingham is twice the player when deployed as an 8 rather than an isolated false 9..."
          required
          rows={3}
          className="w-full min-h-[110px] font-sans text-[17px] leading-[1.45] p-3.5 sm:p-4 bg-[var(--sunken)] text-[var(--ink)] border-[var(--border-w)] border-[var(--ink)] rounded-sm resize-y outline-none mb-4 transition-all focus:ring-2 focus:ring-[var(--lime)]"
        />
        <Button
          type="submit"
          onClick={handleSubmit}
          variant="lime"
          size="lg"
          className="w-full text-base font-bold"
        >
          Check my take →
        </Button>
      </form>

      {/* FEED OF RECENT REVIEWS UNDERNEATH AS A PLAIN LIST */}
      <section>
        <h2 className="font-display font-bold text-xl tracking-tight text-[var(--ink)] mb-3.5">
          Recent reviews
        </h2>

        <div className="flex flex-col gap-3">
          {debates.map((item) => {
            const isLive = item.decision === "LIVE";
            const reviewTarget = item.reviewId
              ? `/review/${item.reviewId}`
              : `/review?take=${encodeURIComponent(item.statement)}${
                  isLive ? "&running=true" : ""
                }`;

            return (
              <a
                href={reviewTarget}
                key={item.id}
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate(reviewTarget);
                }}
                className="block bg-[var(--surface)] border-[var(--border-w)] border-[var(--ink)] rounded-md shadow-hard p-4 sm:p-4.5 cursor-pointer select-none transition-all duration-100 hover:shadow-hard-lg hover:-translate-x-[1px] hover:-translate-y-[1px] active:translate-x-[2px] active:translate-y-[2px] active:shadow-collapse focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lime)]"
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
        </div>
      </section>
    </main>
  );
}
