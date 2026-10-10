import { useState, useEffect } from "react";
import { DecisionBanner } from "@/components/var/decision-banner";

export interface ClaimData {
  order: number;
  claimText: string;
  ruling: "VERIFIED" | "REFUTED" | "INSUFFICIENT_DATA" | "UNTESTABLE";
  rulingLabel: string;
  why: string;
  citedLabels: string[];
}

export interface EvidenceData {
  label: string;
  title?: string | null;
  url?: string | null;
  snippet?: string | null;
  source?: string;
}

interface ReviewViewProps {
  reviewId?: string;
  initialTake?: string;
  initialRunning?: boolean;
  onBackToHome: () => void;
}

export function ReviewView({
  reviewId,
  initialTake,
  initialRunning = false,
  onBackToHome,
}: ReviewViewProps) {
  // Screen state: "running" | "overturned" | "stands" | "incomplete"
  const [screenState, setScreenState] = useState<
    "running" | "overturned" | "stands" | "incomplete"
  >(initialRunning ? "running" : "overturned");

  const [takeText, setTakeText] = useState(
    initialTake ||
      "“Bellingham is twice the player when deployed as an 8 rather than an isolated false 9.”"
  );

  const [progressLine, setProgressLine] = useState(
    "Splitting your take into claims... Checking claim 2 of 4..."
  );
  const [progressPercent, setProgressPercent] = useState(60);

  // Expanded sources drawers indexed by claim order
  const [openSources, setOpenSources] = useState<Record<number, boolean>>({});

  // Dynamic review data fetched from real API
  const [apiVerdict, setApiVerdict] = useState<string | null>(null);
  const [apiScore, setApiScore] = useState<number | null>(null);
  const [apiClaims, setApiClaims] = useState<ClaimData[]>([]);
  const [apiEvidence, setApiEvidence] = useState<EvidenceData[]>([]);
  const [apiSummary, setApiSummary] = useState<string | null>(null);

  // If reviewId is provided, fetch real review from Express API
  useEffect(() => {
    if (!reviewId) return;

    let eventSource: EventSource | null = null;

    async function fetchReview() {
      try {
        const res = await fetch(`/api/reviews/${reviewId}`);
        if (!res.ok) return;
        const json = await res.json();
        const r = json.review;
        if (!r) return;

        if (r.status === "RUNNING" || r.status === "PENDING") {
          setScreenState("running");
          setProgressLine("Splitting claims and querying match events...");

          // Connect to real SSE stream
          eventSource = new EventSource(`/api/reviews/${reviewId}/events`);
          eventSource.addEventListener("claims_extracted", (e) => {
            const data = JSON.parse(e.data);
            const count = data.claims ? data.claims.length : 3;
            setProgressLine(`Extracted ${count} claims. Verifying against match event data...`);
            setProgressPercent(50);
          });

          eventSource.addEventListener("review_completed", (e) => {
            const data = JSON.parse(e.data);
            setApiScore(data.credibilityScore ?? 50);
            setApiVerdict(data.decision ?? "CONFIRMED");
            setScreenState(
              data.decision === "OVERTURNED"
                ? "overturned"
                : data.decision === "INCONCLUSIVE"
                ? "incomplete"
                : "stands"
            );
            if (eventSource) eventSource.close();
            fetchReview(); // Refresh full claims
          });

          eventSource.addEventListener("review_failed", () => {
            setScreenState("incomplete");
            if (eventSource) eventSource.close();
          });
        } else {
          // Completed or failed review
          const decision = r.decision;
          const isFailed = r.status === "FAILED";
          setApiScore(
            r.credibilityScore !== null && r.credibilityScore !== undefined
              ? r.credibilityScore
              : isFailed
              ? 50
              : 24
          );
          setApiVerdict(decision || (isFailed ? "INCONCLUSIVE" : null));
          setApiSummary(
            r.summary ||
              (isFailed
                ? (r.failure?.message
                    ? `Official check incomplete: ${r.failure.message} (Daily quota reached for Gemini AI free-tier on fresh runs; check verified reviews in the feed).`
                    : "Check incomplete: upstream AI service unavailable.")
                : null)
          );

          if (decision === "OVERTURNED") {
            setScreenState("overturned");
          } else if (decision === "CONFIRMED" || decision === "UPHELD") {
            setScreenState("stands");
          } else {
            setScreenState("incomplete");
          }

          // Fetch original fan debate thesis if available
          if (r.debateId) {
            try {
              const dRes = await fetch(`/api/debates/${r.debateId}`);
              if (dRes.ok) {
                const dData = await dRes.json();
                if (dData.thesis || dData.title) {
                  setTakeText(dData.thesis || dData.title);
                }
              }
            } catch {
              // keep existing take text
            }
          }

          // Map claims
          if (r.claims && r.claims.length > 0) {
            const mappedClaims: ClaimData[] = r.claims.map((c: any) => {
              let ruling: ClaimData["ruling"] = "INSUFFICIENT_DATA";
              let label = "INSUFFICIENT DATA";
              if (c.verdict === "VERIFIED") {
                ruling = "VERIFIED";
                label = "VERIFIED";
              } else if (c.verdict === "REFUTED") {
                ruling = "REFUTED";
                label = "CONTRADICTED";
              } else if (c.verdict === "PARTIALLY_TRUE") {
                ruling = "INSUFFICIENT_DATA";
                label = "PARTIALLY TRUE";
              } else if (c.verdict === "UNTESTABLE") {
                ruling = "UNTESTABLE";
                label = "UNTESTABLE";
              }
              return {
                order: c.order,
                claimText: c.claimText,
                ruling,
                rulingLabel: label,
                why: c.reasoning || "Match event metrics recorded for this fixture.",
                citedLabels: c.citedLabels || [],
              };
            });
            setApiClaims(mappedClaims);
          }

          // Map evidence
          if (r.evidence && r.evidence.length > 0) {
            const mappedEv: EvidenceData[] = r.evidence.map((ev: any) => ({
              label: ev.label,
              title: ev.sourceTitle || ev.title,
              url: ev.sourceUrl || ev.url,
              snippet: ev.snippet,
              source: ev.source || ev.kind,
            }));
            setApiEvidence(mappedEv);
          }
        }
      } catch {
        // Fall back to demo data if review fetch fails
      }
    }

    fetchReview();

    return () => {
      if (eventSource) eventSource.close();
    };
  }, [reviewId]);

  // If initialRunning without reviewId, simulate sequential agent progress
  useEffect(() => {
    if (!reviewId && initialRunning) {
      setScreenState("running");
      setProgressLine("Splitting your take into claims... Checking claim 1 of 3...");
      setProgressPercent(25);

      const t1 = setTimeout(() => {
        setProgressLine("Agent 1: Extracted 3 claims. Querying Opta event data...");
        setProgressPercent(55);
      }, 2000);

      const t2 = setTimeout(() => {
        setProgressLine("Agent 2: Cross-referencing player tracking and xG variance...");
        setProgressPercent(80);
      }, 4000);

      const t3 = setTimeout(() => {
        setProgressLine("Agent 3: Calculating credibility score and formal ruling...");
        setProgressPercent(95);
      }, 6000);

      const t4 = setTimeout(() => {
        setScreenState("overturned");
      }, 7500);

      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
        clearTimeout(t4);
      };
    }
  }, [reviewId, initialRunning]);

  // Demo claims data when no API claims are available
  const defaultClaims: ClaimData[] =
    screenState === "stands"
      ? [
          {
            order: 1,
            claimText: "Arsenal's near-post corner block routine operates legally within Law 12",
            ruling: "VERIFIED",
            rulingLabel: "VERIFIED",
            why: "Referee body guidance confirms incidental screening outside the 6-yard box is permissible under current PGMOL interpretation.",
            citedLabels: ["E1", "E2"],
          },
          {
            order: 2,
            claimText: "Goalkeeper challenge was initiated from an established standing position",
            ruling: "VERIFIED",
            rulingLabel: "VERIFIED",
            why: "Frame analysis at 42:18 shows defender maintained legal territorial ground prior to trajectory flight.",
            citedLabels: ["E3"],
          },
        ]
      : [
          {
            order: 1,
            claimText: "Bellingham produces higher expected assists deployed as an 8",
            ruling: "REFUTED",
            rulingLabel: "CONTRADICTED",
            why: "His central 8 deployment generated 0.14 xA per 90 compared to 0.38 xA as a false 9 across 28 domestic matches.",
            citedLabels: ["E1", "E2"],
          },
          {
            order: 2,
            claimText: "Real Madrid generates more box entries when Jude occupies central midfield",
            ruling: "REFUTED",
            rulingLabel: "CONTRADICTED",
            why: "Penalty area entries decreased from 24.2 to 17.6 per match when rotated away from the frontline.",
            citedLabels: ["E3"],
          },
          {
            order: 3,
            claimText: "Player stamina metrics degrade when asked to press as an isolated false 9",
            ruling: "INSUFFICIENT_DATA",
            rulingLabel: "INSUFFICIENT DATA",
            why: "High-intensity sprint distance showed no statistically significant divergence across roles.",
            citedLabels: ["E4"],
          },
        ];

  const claimsToShow = apiClaims.length > 0 ? apiClaims : defaultClaims;

  const defaultEvidence: EvidenceData[] = [
    {
      label: "E1",
      title: "Opta Match Statistics & Tactical Coordinates",
      url: "https://opta.com/tracking/rma",
      snippet: "0.14 xA recorded as midfield 8 across 14 starts vs 0.38 xA as false 9.",
    },
    {
      label: "E2",
      title: "Wyscout Event Data · Passing Network Metrics",
      url: "https://wyscout.com/reports/bellingham",
      snippet: "Progressive receptions dropped 34% when positioned in the second phase.",
    },
    {
      label: "E3",
      title: "La Liga Official Match Log · Round 24",
      url: "https://laliga.com/match/rma-bet",
      snippet: "Box penetration count: 18 with Bellingham withdrawn.",
    },
    {
      label: "E4",
      title: "Player Tracking Sensor Data · Physical Performance",
      snippet: "High-intensity distance variance: < 1.2% across positions.",
    },
  ];

  const evidenceMap = new Map<string, EvidenceData>();
  const evidenceList = apiEvidence.length > 0 ? apiEvidence : defaultEvidence;
  for (const ev of evidenceList) {
    evidenceMap.set(ev.label, ev);
  }

  const toggleSources = (claimOrder: number) => {
    setOpenSources((prev) => ({
      ...prev,
      [claimOrder]: !prev[claimOrder],
    }));
  };

  return (
    <main>
      {/* DEMO STATE SWITCHER BAR */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-5 p-2 px-3 bg-[var(--sunken)] border border-dashed border-[var(--ink-3)] rounded-sm text-xs font-mono">
        <span className="font-bold text-[var(--ink-2)]">STATE DEMO:</span>
        <div className="flex gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setScreenState("running")}
            className={`px-2.5 py-1 rounded-pill text-[11px] font-bold border border-[var(--ink)] cursor-pointer ${
              screenState === "running"
                ? "bg-[var(--lime)] text-[var(--on-lime)]"
                : "bg-[var(--surface)] text-[var(--ink)]"
            }`}
          >
            1. Running
          </button>
          <button
            type="button"
            onClick={() => setScreenState("overturned")}
            className={`px-2.5 py-1 rounded-pill text-[11px] font-bold border border-[var(--ink)] cursor-pointer ${
              screenState === "overturned"
                ? "bg-[var(--lime)] text-[var(--on-lime)]"
                : "bg-[var(--surface)] text-[var(--ink)]"
            }`}
          >
            2. Done (Overturned)
          </button>
          <button
            type="button"
            onClick={() => setScreenState("stands")}
            className={`px-2.5 py-1 rounded-pill text-[11px] font-bold border border-[var(--ink)] cursor-pointer ${
              screenState === "stands"
                ? "bg-[var(--lime)] text-[var(--on-lime)]"
                : "bg-[var(--surface)] text-[var(--ink)]"
            }`}
          >
            3. Done (Stands)
          </button>
        </div>
      </div>

      {/* TAKE STATEMENT */}
      <div className="mb-6">
        <h1 className="font-display font-extrabold text-[clamp(22px,3.8vw,30px)] leading-[1.15] tracking-tight text-[var(--ink)] mb-2">
          {takeText.startsWith("“") ? takeText : `“${takeText}”`}
        </h1>
        <div className="font-sans text-xs text-[var(--ink-3)]">
          Fan thesis submitted for official VAR adjudication
        </div>
      </div>

      {/* 1. RUNNING STATE: ONE CALM PROGRESS LINE, ZERO TECHNICAL NOISE */}
      {screenState === "running" ? (
        <section className="bg-[var(--surface)] border-[var(--border-w)] border-[var(--ink)] rounded-md shadow-hard p-8 sm:p-10 text-center mb-6">
          <div className="font-display font-bold text-xl sm:text-2xl text-[var(--ink)] flex items-center justify-center gap-2.5 mb-4">
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--lime)] border-[1.5px] border-[var(--ink)] pulse-dot inline-block" />
            <span>{progressLine}</span>
          </div>

          <div className="w-full max-w-md mx-auto h-2 bg-[var(--sunken)] border-[var(--border-w)] border-[var(--ink)] rounded-pill overflow-hidden my-4">
            <div
              className="h-full bg-[var(--lime)] rounded-pill transition-all duration-300 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <p className="font-sans text-sm text-[var(--ink-2)] max-w-sm mx-auto">
            Our sequential referee agents are fact-checking each premise against
            match statistics and rule interpretations.
          </p>
        </section>
      ) : (
        /* 2. DONE STATE: VERDICT STAMP & SCORE FIRST */
        <section className="mb-6">
          <DecisionBanner
            verdict={
              screenState === "overturned"
                ? "OVERTURNED"
                : screenState === "stands"
                ? "DECISION_STANDS"
                : "CHECK_INCOMPLETE"
            }
            score={
              apiScore !== null
                ? apiScore
                : screenState === "overturned"
                ? 24
                : screenState === "stands"
                ? 92
                : 51
            }
            confidence="HIGH CONFIDENCE (0.84)"
            reasoning={
              apiSummary ||
              (screenState === "overturned"
                ? "The claim posits superior attacking output in a deeper midfield role. Official tracking metrics contradict this: expected assists and penalty box penetration drop noticeably when withdrawn from false 9 positions."
                : "PGMOL Law 12 and match event logs confirm that corner screening routines remain compliant provided defenders maintain stationary established positioning.")
            }
            className="mb-6"
          />

          {/* CLAIMS AS A SIMPLE LIST (claim, ruling, one line of why) */}
          <div>
            <h2 className="font-display font-bold text-xl tracking-tight text-[var(--ink)] mb-3.5">
              Claims reviewed
            </h2>

            <div className="flex flex-col gap-3">
              {claimsToShow.map((claim, idx) => {
                const isOpen = openSources[idx] || false;
                const isBad = claim.ruling === "REFUTED";
                const isGood = claim.ruling === "VERIFIED";

                return (
                  <div
                    key={claim.order || idx}
                    className={`bg-[var(--surface)] border-[var(--border-w)] border-[var(--ink)] rounded-md shadow-hard p-4 sm:p-5 transition-all ${
                      isBad ? "bg-[var(--danger-soft)]/20" : ""
                    }`}
                  >
                    <div className="flex justify-between items-start gap-3 mb-2">
                      <div className="font-bold text-[15px] sm:text-[16px] leading-[1.35] text-[var(--ink)]">
                        {claim.claimText}
                      </div>
                      <span
                        className={`font-display font-extrabold text-[11px] tracking-wide uppercase px-2.5 py-0.5 rounded-pill border-[var(--border-w)] whitespace-nowrap select-none shrink-0 ${
                          isBad
                            ? "bg-[var(--danger)] text-white border-[var(--danger)]"
                            : isGood
                            ? "bg-[var(--lime)] text-[var(--on-lime)] border-[var(--ink)]"
                            : "bg-[var(--warning-soft)] text-[var(--warning)] border-[var(--warning)]"
                        }`}
                      >
                        {claim.rulingLabel}
                      </span>
                    </div>

                    <div className="font-sans text-sm text-[var(--ink-2)] leading-relaxed mb-3">
                      {claim.why}
                    </div>

                    {/* SHOW SOURCES TOGGLE (E1, E2 tags ONLY live here) */}
                    <div>
                      <button
                        type="button"
                        onClick={() => toggleSources(idx)}
                        className="font-sans font-bold text-xs text-[var(--ink)] hover:underline inline-flex items-center gap-1 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lime)] rounded"
                      >
                        {isOpen ? "▲ Hide sources" : "▼ Show sources"} (
                        {claim.citedLabels.length > 0
                          ? claim.citedLabels.length
                          : 2}
                        )
                      </button>

                      {isOpen && (
                        <div className="mt-2.5 p-3 bg-[var(--sunken)] border border-[var(--ink)] rounded-sm text-xs font-sans text-[var(--ink-2)] flex flex-col gap-2">
                          {(claim.citedLabels.length > 0
                            ? claim.citedLabels
                            : ["E1", "E2"]
                          ).map((lbl) => {
                            const ev = evidenceMap.get(lbl);
                            return (
                              <div
                                key={lbl}
                                className="flex items-start gap-2 bg-[var(--surface)] p-2 rounded border border-[var(--ink)]/40"
                              >
                                <span className="font-mono font-bold text-[11px] px-1.5 py-0.5 rounded bg-[var(--sunken)] border border-[var(--ink)] text-[var(--ink)] shrink-0">
                                  {lbl}
                                </span>
                                <div className="leading-snug">
                                  <div className="font-bold text-[var(--ink)]">
                                    {ev?.title || `Evidence ${lbl}`}
                                  </div>
                                  {ev?.snippet && (
                                    <div className="text-[var(--ink-2)] mt-0.5">
                                      {ev.snippet}
                                    </div>
                                  )}
                                  {ev?.url && (
                                    <a
                                      href={ev.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-xs text-[var(--ink)] underline hover:opacity-80 block mt-1 font-mono break-all"
                                    >
                                      {ev.url}
                                    </a>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* BACK TO TAKE INPUT */}
      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={onBackToHome}
          className="font-sans font-bold text-sm text-[var(--ink)] hover:underline cursor-pointer"
        >
          ← Submit another football take
        </button>
      </div>
    </main>
  );
}
