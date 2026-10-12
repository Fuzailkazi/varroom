import type { HealthResponse } from "@varroom/shared";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScoreGauge } from "@/components/var/score-gauge";

interface ShowcaseViewProps {
  health: HealthResponse | null;
  healthLoading: boolean;
  healthError: string | null;
  onRefreshHealth: () => void;
}

export function ShowcaseView({
  health,
  healthLoading,
  healthError,
  onRefreshHealth,
}: ShowcaseViewProps) {
  const [sliderScore, setSliderScore] = useState(24);
  const [sourcesOpen, setSourcesOpen] = useState(true);

  return (
    <main>
      <header className="mb-6">
        <h1 className="font-display font-extrabold text-[clamp(28px,4.5vw,36px)] leading-[1.05] tracking-tight text-[var(--ink)] mb-1">
          Component Styles
        </h1>
        <p className="font-sans text-sm text-[var(--ink-2)]">
          The simplified DMflo-adapted kit: one primary action, plain words, no dashboard clutter.
        </p>
      </header>

      {/* 1. API HEALTH STATUS */}
      <section className="bg-[var(--surface)] border-[var(--border-w)] border-[var(--ink)] rounded-md shadow-hard p-5 mb-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="font-display font-bold text-lg text-[var(--ink)]">Backend API Health</h2>
            <div className="font-mono text-xs text-[var(--ink-2)] mt-0.5">
              {healthLoading ? (
                "Connecting to API via proxy..."
              ) : healthError ? (
                <span className="text-[var(--danger)] font-bold">Error: {healthError}</span>
              ) : (
                <span className="text-[var(--on-lime)] font-bold">
                  Status: {health?.status} · DB: {health?.database}
                </span>
              )}
            </div>
          </div>
          <Button variant="white" size="sm" onClick={onRefreshHealth} disabled={healthLoading}>
            {healthLoading ? "Checking..." : "Ping API"}
          </Button>
        </div>
      </section>

      {/* 2. VERDICT STAMPS */}
      <section className="bg-[var(--surface)] border-[var(--border-w)] border-[var(--ink)] rounded-md shadow-hard p-5 mb-5">
        <h2 className="font-display font-bold text-lg text-[var(--ink)] mb-3">Verdict Stamps</h2>
        <div className="flex gap-2.5 flex-wrap items-center">
          <Badge variant="stands">DECISION STANDS</Badge>
          <Badge variant="overturned">OVERTURNED</Badge>
          <Badge variant="incomplete">CHECK INCOMPLETE</Badge>
          <Badge variant="live">LIVE VAR CHECK</Badge>
        </div>
      </section>

      {/* 3. BUTTONS & SHADOW COLLAPSE */}
      <section className="bg-[var(--surface)] border-[var(--border-w)] border-[var(--ink)] rounded-md shadow-hard p-5 mb-5">
        <h2 className="font-display font-bold text-lg text-[var(--ink)] mb-1">
          Buttons & Press Effect
        </h2>
        <p className="font-sans text-xs sm:text-sm text-[var(--ink-2)] mb-3">
          Click to test the shadow collapse interaction (`translate(2px, 2px)`).
        </p>
        <div className="flex gap-2.5 flex-wrap items-center">
          <Button variant="lime">Check my take →</Button>
          <Button variant="white">Cancel</Button>
          <Button variant="violet">Secondary</Button>
          <Button variant="destructive">Overturn</Button>
        </div>
      </section>

      {/* 4. SCORE & LEAGUE BAROMETER (20 NOTCHES) */}
      <section className="bg-[var(--surface)] border-[var(--border-w)] border-[var(--ink)] rounded-md shadow-hard p-5 mb-5">
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-display font-bold text-lg text-[var(--ink)]">
            Score & League Barometer
          </h2>
          <span className="font-mono text-xs text-[var(--ink-2)]">
            20 discrete ink-bordered notches
          </span>
        </div>

        <ScoreGauge score={sliderScore} />

        <div className="mt-4 pt-3 border-t border-[var(--line)] flex items-center gap-3">
          <label
            htmlFor="scoreSlider"
            className="font-mono text-xs font-bold text-[var(--ink)] whitespace-nowrap"
          >
            Adjust Score: {sliderScore}
          </label>
          <input
            id="scoreSlider"
            type="range"
            min={0}
            max={100}
            value={sliderScore}
            onChange={(e) => setSliderScore(Number(e.target.value))}
            className="w-full cursor-pointer accent-[var(--lime)]"
          />
        </div>
      </section>

      {/* 5. CLAIM ITEM WITH SOURCES DRAWER */}
      <section className="bg-[var(--surface)] border-[var(--border-w)] border-[var(--ink)] rounded-md shadow-hard p-5 mb-5">
        <h2 className="font-display font-bold text-lg text-[var(--ink)] mb-3">
          Claim Item with Sources Drawer
        </h2>
        <div className="bg-[var(--sunken)] border-[var(--border-w)] border-[var(--ink)] rounded-sm p-4">
          <div className="flex justify-between items-center mb-1">
            <strong className="text-[15px] font-bold text-[var(--ink)]">
              Produces higher expected assists as an 8
            </strong>
            <span className="font-display font-extrabold text-[11px] px-2 py-0.5 rounded-pill bg-[var(--danger)] text-white">
              CONTRADICTED
            </span>
          </div>
          <div className="text-xs sm:text-sm text-[var(--ink-2)] mb-2 font-sans">
            His central 8 deployment generated 0.14 xA vs 0.38 xA as a false 9.
          </div>
          <button
            type="button"
            onClick={() => setSourcesOpen(!sourcesOpen)}
            className="font-sans font-bold text-xs text-[var(--ink)] hover:underline inline-flex items-center gap-1 cursor-pointer"
          >
            {sourcesOpen ? "▲ Hide sources" : "▼ Show sources"}
          </button>
          {sourcesOpen && (
            <div className="mt-2.5 p-3 bg-[var(--surface)] border border-[var(--ink)] rounded-sm text-xs text-[var(--ink-2)] flex items-start gap-2">
              <span className="font-mono font-bold px-1.5 py-0.5 rounded bg-[var(--sunken)] border border-[var(--ink)] text-[var(--ink)] shrink-0">
                E1
              </span>
              <span>Opta Event #34: 0.14 xA recorded across 6 appearances.</span>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
