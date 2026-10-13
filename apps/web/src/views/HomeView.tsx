import { useGSAP } from "@gsap/react";
import { ArrowRight, CheckCircle, Crosshair, Lightning, ShieldCheck } from "@phosphor-icons/react";
import gsap from "gsap";
import { type FormEvent, useRef, useState } from "react";
import { DebateCard } from "@/components/debates/debate-card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spotlight } from "@/components/visual/spotlight";
import { useDebates } from "@/lib/use-debates";

gsap.registerPlugin(useGSAP);

interface HomeViewProps {
  onNavigate: (path: string) => void;
  onSubmitTake: (take: string) => void;
  submitError?: string | null;
  initialTake?: string;
  submitting?: boolean;
}

export function HomeView({
  onNavigate,
  onSubmitTake,
  submitError,
  initialTake = "",
  submitting = false,
}: HomeViewProps) {
  const [take, setTake] = useState(initialTake);
  const heroRef = useRef<HTMLDivElement>(null);
  const { items, loading, error } = useDebates(4);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from("[data-reveal]", {
          y: 22,
          autoAlpha: 0,
          duration: 0.65,
          stagger: 0.1,
          ease: "power2.out",
          clearProps: "all",
        });
      });
      return () => mm.revert();
    },
    { scope: heroRef },
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = take.trim();
    if (clean) onSubmitTake(clean);
  }

  return (
    <main>
      <Spotlight className="home-hero">
        <div
          ref={heroRef}
          className="relative z-10 grid gap-9 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,.75fr)] lg:items-end"
        >
          <div>
            <div
              data-reveal
              className="eyebrow mb-5 flex items-center gap-2 text-[var(--hero-muted)]"
            >
              <span className="live-dot" /> THE PEOPLE'S DECISION DESK{" "}
              <span className="hidden sm:inline">/ EST. 2026</span>
            </div>
            <h1
              data-reveal
              className="max-w-[720px] font-display text-[clamp(3.2rem,8vw,7.2rem)] font-extrabold leading-[.92] tracking-[-.065em] text-white"
            >
              Every take
              <br />
              <span className="text-[var(--lime)]">gets checked.</span>
            </h1>
            <p
              data-reveal
              className="mt-6 max-w-[520px] text-base leading-relaxed text-[var(--hero-muted)] sm:text-lg"
            >
              Put your football opinion on the record. VAR Room checks the claims, follows the
              evidence, and delivers a decision you can share.
            </p>
          </div>
          <div data-reveal className="hero-pitch hidden lg:block" aria-hidden="true">
            <div className="pitch-topline">
              <span>VAR / LIVE REVIEW</span>
              <Crosshair size={19} weight="bold" />
            </div>
            <div className="pitch-lines">
              <div className="pitch-centre" />
              <div className="pitch-box pitch-box-left" />
              <div className="pitch-box pitch-box-right" />
              <span className="pitch-ball">●</span>
            </div>
            <div className="pitch-bottomline">
              <span>FACTS OVER NOISE</span>
              <span>01 / 03</span>
            </div>
          </div>
        </div>
        <div className="hero-index" aria-hidden="true">
          01 / REVIEW THE GAME
        </div>
      </Spotlight>

      <div className="mx-auto max-w-[1180px] px-4 sm:px-6 lg:px-8">
        <section
          className="take-panel relative z-20 -mt-10 sm:-mt-14"
          aria-labelledby="take-heading"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="eyebrow text-[var(--ink-3)]">
              <Lightning size={15} weight="fill" /> NEW REVIEW
            </span>
            <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--ink-3)]">
              Claim by claim · Source by source
            </span>
          </div>
          <h2
            id="take-heading"
            className="mt-4 font-display text-[clamp(1.8rem,3.5vw,2.8rem)] font-extrabold leading-tight tracking-tight"
          >
            What's your football take?
          </h2>
          <form onSubmit={submit} className="mt-5">
            <label htmlFor="take" className="sr-only">
              Your football opinion
            </label>
            <textarea
              id="take"
              value={take}
              onChange={(event) => setTake(event.target.value)}
              placeholder="e.g. Arsenal's high line is the reason they struggle against quick transitions..."
              rows={3}
              minLength={30}
              maxLength={1000}
              required
              className="take-input"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-[470px] text-xs leading-relaxed text-[var(--ink-3)]">
                Make a specific claim about a player, team, tactic, or transfer. We’ll show what the
                sources can support.
              </p>
              <Button type="submit" size="lg" disabled={submitting} className="min-w-[190px] gap-2">
                {submitting ? "Starting review…" : "Check my take"}{" "}
                <ArrowRight size={19} weight="bold" />
              </Button>
            </div>
            {submitError && (
              <p
                role="alert"
                className="mt-4 rounded-md bg-[var(--danger-soft)] p-3 text-sm font-semibold text-[var(--danger)]"
              >
                {submitError}
              </p>
            )}
          </form>
        </section>

        <Separator className="mt-16 bg-[var(--line)]" />
        <section className="grid gap-6 py-7 sm:grid-cols-3" aria-label="How VAR Room works">
          {[
            {
              icon: Crosshair,
              number: "01",
              title: "Make the call",
              description: "Post one clear football opinion.",
            },
            {
              icon: ShieldCheck,
              number: "02",
              title: "Check the evidence",
              description: "Claims are checked against cited sources.",
            },
            {
              icon: CheckCircle,
              number: "03",
              title: "Get the decision",
              description: "See the ruling and how it was reached.",
            },
          ].map(({ icon: Icon, number, title, description }) => (
            <div key={number} className="flex gap-3">
              <div className="process-icon">
                <Icon size={19} weight="bold" />
              </div>
              <div>
                <div className="eyebrow text-[var(--ink-3)]">
                  {number} / {title}
                </div>
                <p className="mt-1 text-sm text-[var(--ink-2)]">{description}</p>
              </div>
            </div>
          ))}
        </section>
        <Separator className="bg-[var(--line)]" />

        <section className="py-16" aria-labelledby="latest-heading">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="eyebrow text-[var(--ink-3)]">FROM THE COMMUNITY</div>
              <h2
                id="latest-heading"
                className="mt-2 font-display text-3xl font-extrabold tracking-tight sm:text-4xl"
              >
                Latest decisions<span className="text-[var(--lime-deep)]">.</span>
              </h2>
            </div>
            <Button variant="outline" onClick={() => onNavigate("/feed")}>
              Explore the feed <ArrowRight size={17} />
            </Button>
          </div>
          {loading ? (
            <p className="feed-message">Loading the latest takes…</p>
          ) : error ? (
            <p role="status" className="feed-message">
              {error}
            </p>
          ) : items.length === 0 ? (
            <p className="feed-message">
              No takes yet. Your opinion could be the first one on the board.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {items.map((item) => (
                <DebateCard key={item.id} debate={item} onNavigate={onNavigate} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
