import { useGSAP } from "@gsap/react";
import {
  ArrowLeft,
  ArrowSquareOut,
  CheckCircle,
  Clock,
  LinkSimple,
  ShareNetwork,
  WarningCircle,
} from "@phosphor-icons/react";
import { Debate, type ReviewClaim, type ReviewEvidence, ReviewResponse } from "@varroom/shared";
import gsap from "gsap";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DecisionBanner } from "@/components/var/decision-banner";

gsap.registerPlugin(useGSAP);

interface ReviewViewProps {
  reviewId?: string;
  initialTake?: string;
  onBackToHome: () => void;
}

const rulingLabels: Record<ReviewClaim["verdict"], string> = {
  PENDING: "Pending",
  VERIFIED: "Verified",
  PARTIALLY_TRUE: "Partly true",
  REFUTED: "Contradicted",
  INSUFFICIENT_DATA: "Insufficient data",
  UNTESTABLE: "Untestable",
};

function claimEvidence(claim: ReviewClaim, evidence: ReviewEvidence[]) {
  return evidence.filter(
    (source) => source.claimOrder === claim.order && claim.citedLabels.includes(source.label),
  );
}

function safeSourceUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function ReviewView({ reviewId, initialTake, onBackToHome }: ReviewViewProps) {
  const [review, setReview] = useState<ReviewResponse["review"] | null>(null);
  const [take, setTake] = useState(initialTake || "");
  const [loading, setLoading] = useState(Boolean(reviewId));
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("The referee is reviewing your take.");
  const [openClaims, setOpenClaims] = useState<Record<number, boolean>>({});
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const decisionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!reviewId) return;
    let cancelled = false;
    let stream: EventSource | null = null;

    async function loadReview() {
      try {
        const response = await fetch(`/api/reviews/${reviewId}`);
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? "We couldn't find this review."
              : "We couldn't load this review.",
          );
        const parsed = ReviewResponse.safeParse(await response.json());
        if (!parsed.success)
          throw new Error("The match report returned incomplete data. Please try again.");
        const result = parsed.data.review;
        if (cancelled) return;
        setReview(result);
        setError(null);
        if (result.status === "QUEUED" || result.status === "RUNNING") {
          setProgress("The referee is checking the claims and gathering sources.");
          if (!stream) {
            stream = new EventSource(`/api/reviews/${reviewId}/events`);
            stream.addEventListener("claims_extracted", (event) => {
              try {
                const data = JSON.parse((event as MessageEvent).data);
                if (!cancelled)
                  setProgress(
                    `${data.claims?.length || "Several"} claims identified. Checking the evidence now.`,
                  );
              } catch {
                /* Keep the last confirmed progress line. */
              }
            });
            stream.addEventListener("review_completed", () => {
              stream?.close();
              stream = null;
              void loadReview();
            });
            stream.addEventListener("review_failed", () => {
              stream?.close();
              stream = null;
              void loadReview();
            });
            stream.onerror = () => {
              stream?.close();
              stream = null;
              if (!cancelled)
                setProgress("The live connection paused. Refresh to check the latest status.");
            };
          }
        } else {
          stream?.close();
          stream = null;
        }

        if (result.debateId) {
          try {
            const debateResponse = await fetch(`/api/debates/${result.debateId}`);
            if (debateResponse.ok) {
              const debate = Debate.parse(await debateResponse.json());
              if (!cancelled) setTake(debate.thesis);
            }
          } catch {
            /* The review remains readable without the original thesis. */
          }
        }
      } catch (cause) {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "The review could not load.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadReview();
    return () => {
      cancelled = true;
      stream?.close();
    };
  }, [reviewId]);

  useGSAP(
    () => {
      if (review?.status !== "COMPLETE") return;
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(".decision-motion", {
          y: 18,
          autoAlpha: 0,
          duration: 0.55,
          stagger: 0.09,
          ease: "power2.out",
          clearProps: "all",
        });
      });
      return () => mm.revert();
    },
    { scope: decisionRef, dependencies: [review?.status] },
  );

  const running = review?.status === "QUEUED" || review?.status === "RUNNING";
  const verdict =
    review?.status === "COMPLETE" ? review.decision || "INCONCLUSIVE" : "CHECK_INCOMPLETE";

  async function shareDecision() {
    try {
      if (navigator.share) {
        await navigator.share({ title: "VAR Room decision", url: window.location.href });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        setShareStatus("Link copied");
      }
    } catch {
      setShareStatus("Could not share this link");
    }
  }

  return (
    <main className="mx-auto max-w-[1180px] px-4 pb-20 pt-7 sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={onBackToHome}
        className="inline-flex items-center gap-2 text-sm font-bold text-[var(--ink-2)] hover:text-[var(--ink)]"
      >
        <ArrowLeft size={17} /> Back to the room
      </button>
      <header className="review-header mt-6">
        <div className="eyebrow text-[var(--lime)]">
          <span className="live-dot" /> VAR DECISION CENTRE
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <h1 className="max-w-[850px] font-display text-[clamp(2rem,4vw,3.6rem)] font-extrabold leading-[1.04] tracking-[-.045em] text-white">
              {take
                ? take.length > 220
                  ? `${take.slice(0, 217)}…`
                  : take
                : loading
                  ? "Loading the match report…"
                  : "Review on the record"}
            </h1>
            {take.length > 220 && (
              <details className="mt-4 max-w-[760px] text-sm text-[var(--hero-muted)]">
                <summary className="cursor-pointer font-bold text-[var(--lime)]">
                  Read the full take
                </summary>
                <p className="mt-2 leading-relaxed">{take}</p>
              </details>
            )}
            <p className="mt-4 text-sm text-[var(--hero-muted)]">
              Each claim is checked separately. Open the source list to see the evidence behind the
              ruling.
            </p>
          </div>
          {reviewId && (
            <span className="font-mono text-[10px] uppercase tracking-[.16em] text-[var(--hero-muted)]">
              CASE {reviewId.slice(0, 8).toUpperCase()}
            </span>
          )}
        </div>
      </header>

      {!reviewId ? (
        <div className="review-message">
          <WarningCircle size={24} />
          <div>
            <h2>No review selected</h2>
            <p>Submit a take or choose a decision from the feed.</p>
          </div>
          <Button onClick={onBackToHome}>Post a take</Button>
        </div>
      ) : loading ? (
        <div className="review-message">
          <span className="live-dot" />
          <div>
            <h2>Loading the match report</h2>
            <p>Checking the latest status.</p>
          </div>
        </div>
      ) : error ? (
        <div role="alert" className="review-message">
          <WarningCircle size={24} />
          <div>
            <h2>Review unavailable</h2>
            <p>{error}</p>
          </div>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      ) : running ? (
        <section className="review-message">
          <span className="live-dot" />
          <div>
            <div className="eyebrow text-[var(--lime-deep)]">LIVE VAR CHECK</div>
            <h2 className="mt-2">Checking the evidence</h2>
            <p>{progress}</p>
            <div className="review-progress" />
          </div>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Refresh status
          </Button>
        </section>
      ) : review ? (
        <div
          ref={decisionRef}
          className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(270px,.65fr)]"
        >
          <div>
            <div className="decision-motion">
              <DecisionBanner
                verdict={verdict}
                score={review.credibilityScore}
                reasoning={
                  review.summary ||
                  review.failure?.message ||
                  "The check could not reach a decision."
                }
              />
            </div>
            <section className="decision-motion mt-10" aria-labelledby="claims-heading">
              <div className="mb-5 flex items-end justify-between gap-3">
                <div>
                  <div className="eyebrow text-[var(--ink-3)]">THE MATCH REPORT</div>
                  <h2
                    id="claims-heading"
                    className="mt-1 font-display text-3xl font-extrabold tracking-tight"
                  >
                    Claim by claim
                  </h2>
                </div>
                <span className="font-mono text-xs text-[var(--ink-3)]">
                  {review.claims.length} CLAIMS
                </span>
              </div>
              {review.claims.length === 0 ? (
                <p className="feed-message">No claim breakdown was recorded for this check.</p>
              ) : (
                <div className="space-y-3">
                  {review.claims.map((claim) => {
                    const sources = claimEvidence(claim, review.evidence);
                    const open = openClaims[claim.order] || false;
                    return (
                      <article key={claim.order} className="claim-card">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <span className="eyebrow text-[var(--ink-3)]">
                            CLAIM {String(claim.order).padStart(2, "0")}
                          </span>
                          <span className={`ruling ruling-${claim.verdict.toLowerCase()}`}>
                            {rulingLabels[claim.verdict]}
                          </span>
                        </div>
                        <h3 className="mt-3 font-display text-lg font-bold leading-snug">
                          {claim.claimText}
                        </h3>
                        {claim.reasoning && (
                          <p className="mt-3 text-sm leading-relaxed text-[var(--ink-2)]">
                            {claim.reasoning}
                          </p>
                        )}
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() =>
                            setOpenClaims((previous) => ({ ...previous, [claim.order]: !open }))
                          }
                          className="source-toggle"
                        >
                          <LinkSimple size={15} />{" "}
                          {open ? "Hide sources" : `View sources (${sources.length})`}
                        </button>
                        {open && (
                          <div className="source-list">
                            {sources.length === 0 ? (
                              <p className="text-sm text-[var(--ink-3)]">
                                No cited source was recorded for this claim.
                              </p>
                            ) : (
                              sources.map((source) => (
                                <div key={source.label} className="source-row">
                                  <span className="source-label">{source.label}</span>
                                  <div>
                                    <div className="font-semibold">
                                      {source.sourceTitle || "Evidence source"}
                                    </div>
                                    <p className="mt-1 text-xs text-[var(--ink-3)]">
                                      {source.status === "ok" ? source.kind : "Source unavailable"}
                                    </p>
                                    {source.status === "ok" && safeSourceUrl(source.sourceUrl) && (
                                      <a
                                        href={safeSourceUrl(source.sourceUrl) || undefined}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="source-link"
                                      >
                                        Open source <ArrowSquareOut size={14} />
                                      </a>
                                    )}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
          <aside className="decision-motion review-aside">
            <div className="eyebrow text-[var(--ink-3)]">AT A GLANCE</div>
            <div className="mt-6 flex items-center gap-3">
              <CheckCircle size={21} weight="bold" className="text-[var(--lime-deep)]" />
              <span>{review.status === "COMPLETE" ? "Review completed" : "Check incomplete"}</span>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <LinkSimple size={21} weight="bold" className="text-[var(--lime-deep)]" />
              <span>
                {review.evidence.filter((source) => source.status === "ok").length} sources recorded
              </span>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Clock size={21} weight="bold" className="text-[var(--lime-deep)]" />
              <span>
                {review.completedAt
                  ? new Date(review.completedAt).toLocaleDateString()
                  : "No completion time"}
              </span>
            </div>
            <p className="mt-7 border-t border-[var(--line)] pt-5 text-xs leading-relaxed text-[var(--ink-3)]">
              The score is calculated from checked claims. Open each claim to inspect its cited
              sources.
            </p>
            {review.status === "COMPLETE" && (
              <Button
                type="button"
                variant="outline"
                onClick={shareDecision}
                className="mt-6 w-full gap-2"
              >
                <ShareNetwork size={17} /> Share decision
              </Button>
            )}
            {shareStatus && (
              <p role="status" className="mt-2 text-xs text-[var(--ink-2)]">
                {shareStatus}
              </p>
            )}
          </aside>
        </div>
      ) : null}
    </main>
  );
}
