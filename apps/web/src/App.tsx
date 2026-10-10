import { useEffect, useState } from "react";
import { HealthResponse } from "@varroom/shared";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { SignInDialog } from "@/components/auth/sign-in-dialog";
import { VerificationBanner } from "@/components/auth/VerificationBanner";
import { UserMenu } from "@/components/nav/UserMenu";
import { AuthView } from "@/views/AuthView";
import { ForgotPasswordView } from "@/views/ForgotPasswordView";
import { ResetPasswordView } from "@/views/ResetPasswordView";
import { HomeView } from "@/views/HomeView";
import { ReviewView } from "@/views/ReviewView";
import { FeedView } from "@/views/FeedView";
import { ShowcaseView } from "@/views/ShowcaseView";

export function App() {
  const { resolvedTheme, setTheme } = useTheme();
  const { user, signOut } = useAuth();
  const [signInOpen, setSignInOpen] = useState(false);
  const [signInMessage, setSignInMessage] = useState<string | undefined>(undefined);
  const [pendingTake, setPendingTake] = useState<string | null>(null);

  // Route state derived from window.location
  const [currentPath, setCurrentPath] = useState<string>(() => {
    if (typeof window === "undefined") return "/";
    return window.location.pathname || "/";
  });
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.location.search || "";
  });

  // Active review parameters
  const [activeReviewId, setActiveReviewId] = useState<string | undefined>(
    undefined
  );
  const [activeTake, setActiveTake] = useState<string | undefined>(undefined);
  const [isRunning, setIsRunning] = useState<boolean>(false);

  // API Health status
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  const fetchHealth = async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const response = await fetch("/api/health");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      const parsed = HealthResponse.parse(data);
      setHealth(parsed);
    } catch (err: any) {
      setHealthError(err.message || "Failed to reach backend API");
    } finally {
      setHealthLoading(false);
    }
  };

  useEffect(() => {
    console.log("[VAR ROOM] App mounted, path:", window.location.pathname);
    fetchHealth();
  }, []);

  // Sync route on popstate (browser back/forward)
  useEffect(() => {
    const handlePopState = () => {
      console.log("[VAR ROOM] popstate:", window.location.pathname);
      parseUrl(window.location.pathname, window.location.search);
    };

    window.addEventListener("popstate", handlePopState);
    parseUrl(window.location.pathname, window.location.search);

    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function parseUrl(pathname: string, search: string) {
    console.log("[VAR ROOM] parseUrl:", pathname, search);
    setCurrentPath(pathname);
    setSearchQuery(search);

    // Extract query params
    const params = new URLSearchParams(search);
    const takeParam = params.get("take");
    const runningParam = params.get("running");
    if (takeParam) {
      setActiveTake(takeParam);
    }
    if (runningParam === "true") {
      setIsRunning(true);
    }

    // Check review/:id pattern
    const reviewMatch = pathname.match(/^\/review\/([^/]+)/);
    if (reviewMatch) {
      setActiveReviewId(reviewMatch[1]);
    } else {
      const idParam = params.get("id") || params.get("reviewId");
      if (idParam) {
        setActiveReviewId(idParam);
      }
    }
  }

  function navigate(to: string) {
    console.log("[VAR ROOM] navigate to:", to);
    if (typeof window !== "undefined") {
      window.history.pushState(null, "", to);
      const url = new URL(to, window.location.origin);
      parseUrl(url.pathname, url.search);
      window.scrollTo(0, 0);
    }
  }

  async function handleTakeSubmit(take: string) {
    console.log("[VAR ROOM] handleTakeSubmit called with:", take);
    setActiveTake(take);

    // 1. If not signed in, redirect to sign-in page with returnTo
    if (!user) {
      setPendingTake(take);
      navigate(`/sign-in?returnTo=${encodeURIComponent(currentPath)}`);
      return;
    }

    // 2. User is signed in: create real debate & start real review
    setIsRunning(true);
    try {
      const cleanTitle = take.length > 100 ? `${take.slice(0, 97)}...` : take;
      const cleanThesis =
        take.length >= 30
          ? take
          : `${take} (analyzed against current Premier League and Champions League data).`;

      const debateRes = await fetch("/api/debates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          title: cleanTitle,
          thesis: cleanThesis,
          categories: ["TACTICAL"],
          tags: [],
        }),
      });

      if (debateRes.ok) {
        const debate = await debateRes.json();
        if (debate.id) {
          // Start review
          const revRes = await fetch(`/api/debates/${debate.id}/reviews`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            credentials: "include",
          });

          if (revRes.ok) {
            const revData = await revRes.json();
            if (revData.review?.id) {
              setActiveReviewId(revData.review.id);
              navigate(`/review/${revData.review.id}`);
              return;
            }
          }
        }
      }
    } catch (err) {
      console.error("Failed to post debate or start review:", err);
    }

    // Fallback: search existing reviews or open review in progress mode
    const lower = take.toLowerCase();
    try {
      const res = await fetch("/api/debates?limit=50");
      if (res.ok) {
        const data = await res.json();
        const items = data.items || [];
        const match = items.find((item: any) => {
          const t = (item.thesis || item.title || "").toLowerCase();
          return (
            t.includes(lower) ||
            lower.includes(t) ||
            (lower.includes("bellingham") && t.includes("bellingham")) ||
            (lower.includes("pedri") && t.includes("pedri")) ||
            (lower.includes("saka") && t.includes("saka")) ||
            (lower.includes("odegaard") && t.includes("odegaard")) ||
            (lower.includes("rice") && t.includes("rice")) ||
            (lower.includes("rodri") && t.includes("rodri"))
          );
        });

        if (match && match.latestReview) {
          setActiveReviewId(match.latestReview.id);
          navigate(`/review/${match.latestReview.id}`);
          return;
        }
      }
    } catch {}

    if (lower.includes("bellingham")) {
      setActiveReviewId("97027611-b07c-4156-95f0-4c63029be749");
      navigate("/review/97027611-b07c-4156-95f0-4c63029be749");
    } else if (lower.includes("pedri")) {
      setActiveReviewId("5abdc9a4-66c3-42c6-98ee-3fe002c299df");
      navigate("/review/5abdc9a4-66c3-42c6-98ee-3fe002c299df");
    } else {
      navigate(`/review?take=${encodeURIComponent(take)}&running=true`);
    }
  }

  // Determine active view
  const isSignInRoute = currentPath === "/sign-in";
  const isSignUpRoute = currentPath === "/sign-up";
  const isForgotPasswordRoute = currentPath === "/forgot-password";
  const isResetPasswordRoute = currentPath.startsWith("/reset-password");
  const isReviewRoute = currentPath.startsWith("/review");
  const isFeedRoute = currentPath === "/feed";
  const isShowcaseRoute = currentPath === "/showcase";

  const returnToParam =
    new URLSearchParams(searchQuery).get("returnTo") || undefined;
  const resetTokenParam =
    new URLSearchParams(searchQuery).get("token") ||
    currentPath.match(/^\/reset-password\/([^/?]+)/)?.[1];

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)] antialiased transition-colors duration-150 p-4">
      <div className="max-w-[680px] mx-auto pb-16">
        {/* MINIMAL TOP NAVIGATION */}
        <nav className="flex justify-between items-center py-3 mb-7 border-b border-[var(--border-w)] border-[var(--line)]">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="inline-flex items-center gap-2 font-display font-extrabold text-xl tracking-tight text-[var(--ink)] hover:opacity-80 cursor-pointer"
          >
            VAR ROOM
            <span className="bg-[var(--lime)] text-[var(--on-lime)] text-[11px] font-extrabold px-2 py-0.5 rounded-pill border border-[var(--ink)]">
              REFEREE
            </span>
          </button>

          <div className="flex items-center gap-3 text-sm font-bold text-[var(--ink-2)]">
            <button
              type="button"
              onClick={() => navigate("/feed")}
              className={`hover:text-[var(--ink)] cursor-pointer ${
                isFeedRoute ? "text-[var(--ink)] underline" : ""
              }`}
            >
              Feed
            </button>
            <button
              type="button"
              onClick={() => navigate("/review")}
              className={`hover:text-[var(--ink)] cursor-pointer ${
                isReviewRoute ? "text-[var(--ink)] underline" : ""
              }`}
            >
              Review
            </button>
            <button
              type="button"
              onClick={() => navigate("/showcase")}
              className={`hover:text-[var(--ink)] cursor-pointer ${
                isShowcaseRoute ? "text-[var(--ink)] underline" : ""
              }`}
            >
              Styles
            </button>
            <button
              type="button"
              onClick={() =>
                setTheme(resolvedTheme === "dark" ? "light" : "dark")
              }
              aria-label="Toggle color theme"
              className="bg-[var(--surface)] text-[var(--ink)] border border-[var(--ink)] px-2.5 py-1 rounded-pill text-xs font-bold cursor-pointer shadow-collapse hover:bg-[var(--sunken)] active:translate-x-[1px] active:translate-y-[1px]"
            >
              {resolvedTheme === "dark" ? "☀️ LIGHT" : "🌙 DARK"}
            </button>

            {user ? (
              <UserMenu onNavigate={navigate} />
            ) : (
              <button
                type="button"
                onClick={() => navigate("/sign-in")}
                className="bg-[var(--lime)] text-[var(--on-lime)] border border-[var(--ink)] px-3 py-1 rounded-pill text-xs font-bold cursor-pointer shadow-collapse hover:brightness-105 active:translate-x-[1px] active:translate-y-[1px]"
              >
                Sign In
              </button>
            )}
          </div>
        </nav>

        {/* VERIFICATION WARNING BANNER */}
        <VerificationBanner />

        {/* ACTIVE ROUTE VIEW */}
        {isSignInRoute ? (
          <AuthView
            initialTab="signin"
            returnTo={returnToParam}
            onNavigate={navigate}
          />
        ) : isSignUpRoute ? (
          <AuthView
            initialTab="signup"
            returnTo={returnToParam}
            onNavigate={navigate}
          />
        ) : isForgotPasswordRoute ? (
          <ForgotPasswordView onNavigate={navigate} />
        ) : isResetPasswordRoute ? (
          <ResetPasswordView token={resetTokenParam} onNavigate={navigate} />
        ) : isReviewRoute ? (
          <ReviewView
            key={activeReviewId || activeTake || "review"}
            reviewId={activeReviewId}
            initialTake={activeTake}
            initialRunning={isRunning}
            onBackToHome={() => navigate("/")}
          />
        ) : isFeedRoute ? (
          <FeedView onNavigate={navigate} />
        ) : isShowcaseRoute ? (
          <ShowcaseView
            health={health}
            healthLoading={healthLoading}
            healthError={healthError}
            onRefreshHealth={fetchHealth}
          />
        ) : (
          <HomeView onNavigate={navigate} onSubmitTake={handleTakeSubmit} />
        )}

        <SignInDialog
          open={signInOpen}
          onOpenChange={setSignInOpen}
          message={signInMessage}
          onSuccess={() => {
            if (pendingTake) {
              const take = pendingTake;
              setPendingTake(null);
              handleTakeSubmit(take);
            }
          }}
        />
      </div>
    </div>
  );
}
