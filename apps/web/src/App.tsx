import { ArrowRight, Moon, Sun, Television } from "@phosphor-icons/react";
import { HealthResponse } from "@varroom/shared";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { UserMenu } from "@/components/nav/UserMenu";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { HomeView } from "@/views/HomeView";

const AuthView = lazy(async () => ({ default: (await import("@/views/AuthView")).AuthView }));
const AccountView = lazy(async () => ({
  default: (await import("@/views/AccountView")).AccountView,
}));
const FeedView = lazy(async () => ({ default: (await import("@/views/FeedView")).FeedView }));
const ForgotPasswordView = lazy(async () => ({
  default: (await import("@/views/ForgotPasswordView")).ForgotPasswordView,
}));
const ResetPasswordView = lazy(async () => ({
  default: (await import("@/views/ResetPasswordView")).ResetPasswordView,
}));
const ReviewView = lazy(async () => ({ default: (await import("@/views/ReviewView")).ReviewView }));
const ShowcaseView = lazy(async () => ({
  default: (await import("@/views/ShowcaseView")).ShowcaseView,
}));

function currentLocation() {
  return { pathname: window.location.pathname || "/", search: window.location.search || "" };
}

export function App() {
  const { resolvedTheme, setTheme } = useTheme();
  const { user } = useAuth();
  const [location, setLocation] = useState(currentLocation);
  const [draft, setDraft] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const response = await fetch("/api/health");
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      setHealth(HealthResponse.parse(await response.json()));
    } catch (cause) {
      setHealthError(cause instanceof Error ? cause.message : "API unavailable");
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => setLocation(currentLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function navigate(to: string) {
    window.history.pushState(null, "", to);
    setLocation(currentLocation());
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  async function handleTakeSubmit(take: string) {
    if (submitting) return;
    setSubmitError(null);
    setDraft(take);
    if (!user) {
      navigate("/sign-in?returnTo=%2F");
      return;
    }
    if (take.length < 30 || take.length > 1000) {
      setSubmitError("Write a specific take between 30 and 1000 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const debateResponse = await fetch("/api/debates", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: take.replace(/[\r\n]+/g, " ").slice(0, 120),
          thesis: take,
          categories: ["TACTICAL"],
          tags: [],
        }),
      });
      if (!debateResponse.ok) {
        const body = await debateResponse.json().catch(() => null);
        const code = body?.error?.code;
        if (code === "UNAUTHENTICATED") {
          throw new Error("Your session expired. Sign in again to post your take.");
        }
        throw new Error(body?.error?.message || "We couldn't post your take. Please try again.");
      }
      const debate = await debateResponse.json();
      if (!debate.id)
        throw new Error("The debate was created without an ID. Please refresh the feed.");
      const reviewResponse = await fetch(`/api/debates/${debate.id}/reviews`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!reviewResponse.ok) {
        if (reviewResponse.status === 429) {
          throw new Error(
            "Your take was posted, but today's review limit has been reached. Find it in the community feed.",
          );
        }
        throw new Error(
          "Your take was posted, but the review could not start. It is still in the community feed.",
        );
      }
      const result = await reviewResponse.json();
      if (!result.review?.id)
        throw new Error("The review could not start. Find your take in the community feed.");
      setDraft("");
      navigate(`/review/${result.review.id}`);
    } catch (cause) {
      setSubmitError(
        cause instanceof Error ? cause.message : "Something went wrong. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const { pathname, search } = location;
  const query = new URLSearchParams(search);
  const reviewId = pathname.match(/^\/review\/([^/]+)/)?.[1] || query.get("id") || undefined;
  const isReview = pathname.startsWith("/review");
  const isFeed = pathname === "/feed";
  const isShowcase = pathname === "/showcase" && import.meta.env.DEV;
  const returnTo = query.get("returnTo") || undefined;
  const resetToken = query.get("token") || pathname.match(/^\/reset-password\/([^/?]+)/)?.[1];

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)] antialiased">
      <header className="site-header">
        <div className="mx-auto flex max-w-[1340px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="brand-lockup"
            aria-label="VAR Room home"
          >
            <span className="brand-icon">
              <Television size={22} weight="bold" />
            </span>
            <span className="font-display text-xl font-extrabold tracking-[-.055em] text-white sm:text-2xl">
              VAR<span className="text-[var(--lime)]">ROOM</span>
            </span>
            <span className="brand-divider hidden sm:block" />
            <span className="hidden font-mono text-[10px] font-bold uppercase tracking-[.2em] text-[var(--hero-muted)] sm:block">
              Football, verified.
            </span>
          </button>
          <nav className="flex items-center gap-2 sm:gap-4" aria-label="Main navigation">
            <button
              type="button"
              onClick={() => navigate("/feed")}
              aria-current={isFeed ? "page" : undefined}
              className={`nav-link ${isFeed ? "is-active" : ""}`}
            >
              The feed
            </button>
            <button
              type="button"
              onClick={() => navigate("/")}
              className="nav-link hidden sm:inline-flex"
            >
              Home
            </button>
            <button
              type="button"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              aria-label={resolvedTheme === "dark" ? "Use light theme" : "Use dark theme"}
              className="theme-button hidden sm:grid"
            >
              {resolvedTheme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            {user ? (
              <UserMenu onNavigate={navigate} />
            ) : (
              <Button size="sm" onClick={() => navigate("/sign-in")}>
                Sign in <ArrowRight size={15} />
              </Button>
            )}
          </nav>
        </div>
      </header>

      <Suspense
        fallback={
          <div className="mx-auto max-w-[1180px] px-4 py-16 text-sm text-[var(--ink-2)]">
            Loading the room…
          </div>
        }
      >
        {pathname === "/sign-in" ? (
          <div className="auth-shell">
            <AuthView initialTab="signin" returnTo={returnTo} onNavigate={navigate} />
          </div>
        ) : pathname === "/sign-up" ? (
          <div className="auth-shell">
            <AuthView initialTab="signup" returnTo={returnTo} onNavigate={navigate} />
          </div>
        ) : pathname === "/account" ? (
          <AccountView onNavigate={navigate} />
        ) : pathname === "/forgot-password" ? (
          <div className="auth-shell">
            <ForgotPasswordView onNavigate={navigate} />
          </div>
        ) : pathname.startsWith("/reset-password") ? (
          <div className="auth-shell">
            <ResetPasswordView token={resetToken} onNavigate={navigate} />
          </div>
        ) : isReview ? (
          <ReviewView
            key={reviewId || "review"}
            reviewId={reviewId}
            initialTake={query.get("take") || undefined}
            onBackToHome={() => navigate("/")}
          />
        ) : isFeed ? (
          <FeedView onNavigate={navigate} />
        ) : isShowcase ? (
          <div className="auth-shell">
            <ShowcaseView
              health={health}
              healthLoading={healthLoading}
              healthError={healthError}
              onRefreshHealth={fetchHealth}
            />
          </div>
        ) : (
          <HomeView
            onNavigate={navigate}
            onSubmitTake={handleTakeSubmit}
            initialTake={draft}
            submitError={submitError}
            submitting={submitting}
          />
        )}
      </Suspense>

      <footer className="site-footer">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-4 px-4 py-7 sm:px-6 lg:px-8">
          <div className="font-display text-lg font-extrabold tracking-tight">
            VAR<span className="text-[var(--lime-deep)]">ROOM</span>
          </div>
          <p className="text-xs text-[var(--ink-3)]">
            Football opinions deserve evidence. © {new Date().getFullYear()} VAR Room.
          </p>
        </div>
      </footer>
    </div>
  );
}
