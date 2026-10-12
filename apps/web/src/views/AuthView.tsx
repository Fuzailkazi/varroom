import { Eye, EyeSlash, WarningCircle } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { suggestUsername } from "@/lib/auth-utils";
import { sanitizeReturnTo } from "./auth-navigation";

interface AuthViewProps {
  initialTab?: "signin" | "signup";
  returnTo?: string;
  onNavigate: (path: string) => void;
}

export function AuthView({ initialTab = "signin", returnTo, onNavigate }: AuthViewProps) {
  const { signIn, signUp } = useAuth();
  const [tab, setTab] = useState<"signin" | "signup">(initialTab);

  // Sign in fields
  const [identifier, setIdentifier] = useState("");
  const [signInPassword, setSignInPassword] = useState("");

  // Sign up fields
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [email, setEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");

  // Common UI state
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const safeDestination = sanitizeReturnTo(returnTo);

  const handleDisplayNameChange = (val: string) => {
    setDisplayName(val);
    if (!usernameTouched) {
      setUsername(suggestUsername(val));
    }
  };

  const handleSignInSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const res = await signIn(identifier, signInPassword);
    setSubmitting(false);

    if (res.success) {
      onNavigate(safeDestination);
    } else {
      setError(res.error || "Failed to sign in. Check your credentials.");
    }
  };

  const handleSignUpSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const res = await signUp({
      name: displayName,
      username,
      email,
      password: signUpPassword,
    });
    setSubmitting(false);

    if (res.success) {
      onNavigate(safeDestination);
    } else {
      setError(res.error || "Failed to create account. Check your details.");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center pt-2 pb-12 animate-in fade-in-50 duration-200">
      <div className="w-full max-w-[440px] bg-[var(--surface)] text-[var(--ink)] border-[var(--border-w)] border-[var(--ink)] rounded-md shadow-hard p-6 sm:p-7">
        {/* SEGMENTED TABS */}
        <div className="grid grid-cols-2 p-1 bg-[var(--sunken)] rounded-pill border border-[var(--line)] mb-6">
          <button
            type="button"
            onClick={() => {
              setTab("signin");
              setError(null);
            }}
            className={`py-2 text-xs sm:text-sm font-display font-extrabold rounded-pill transition-all cursor-pointer ${
              tab === "signin"
                ? "bg-[var(--lime)] text-[var(--on-lime)] border border-[var(--ink)] shadow-collapse"
                : "text-[var(--ink-2)] hover:text-[var(--ink)]"
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("signup");
              setError(null);
            }}
            className={`py-2 text-xs sm:text-sm font-display font-extrabold rounded-pill transition-all cursor-pointer ${
              tab === "signup"
                ? "bg-[var(--lime)] text-[var(--on-lime)] border border-[var(--ink)] shadow-collapse"
                : "text-[var(--ink-2)] hover:text-[var(--ink)]"
            }`}
          >
            Create Account
          </button>
        </div>

        {/* HEADER */}
        <div className="mb-5 text-left">
          <h1 className="font-display font-extrabold text-2xl tracking-tight text-[var(--ink)]">
            {tab === "signin" ? "Welcome back to the VAR Room" : "Claim your VAR Room whistle"}
          </h1>
          <p className="text-xs sm:text-sm text-[var(--ink-2)] mt-1 leading-relaxed">
            {tab === "signin"
              ? "Check decisions, defend your takes, and rise through the pundit ranks."
              : "Join the only football board where claims are audited by cold hard evidence."}
          </p>
        </div>

        {/* ERROR CALLOUT */}
        {error && (
          <div className="flex items-start gap-2.5 p-3 mb-4 bg-[var(--danger-soft)] text-[var(--danger)] text-xs font-bold rounded-sm border border-[var(--danger)] animate-in fade-in-50 duration-150">
            <WarningCircle className="h-4 w-4 shrink-0 mt-0.5" weight="bold" />
            <div className="leading-tight">{error}</div>
          </div>
        )}

        {/* SIGN IN FORM */}
        {tab === "signin" ? (
          <form onSubmit={handleSignInSubmit} className="flex flex-col gap-4">
            <div>
              <Label
                htmlFor="sign-in-identifier"
                className="text-xs font-bold mb-1.5 block text-[var(--ink)]"
              >
                Email or username
              </Label>
              <Input
                id="sign-in-identifier"
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="jude_fan or jude@madrid.com"
                required
                autoComplete="username"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <Label
                  htmlFor="sign-in-password"
                  className="text-xs font-bold block text-[var(--ink)]"
                >
                  Password
                </Label>
                <button
                  type="button"
                  onClick={() => onNavigate("/forgot-password")}
                  className="text-xs font-bold text-[var(--ink-2)] hover:text-[var(--ink)] underline cursor-pointer"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Input
                  id="sign-in-password"
                  type={showPassword ? "text" : "password"}
                  value={signInPassword}
                  onChange={(e) => setSignInPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ink-3)] hover:text-[var(--ink)] cursor-pointer"
                >
                  {showPassword ? (
                    <EyeSlash className="h-4 w-4" weight="bold" />
                  ) : (
                    <Eye className="h-4 w-4" weight="bold" />
                  )}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              variant="lime"
              disabled={submitting}
              className="w-full mt-2 text-sm font-extrabold"
            >
              {submitting ? "Signing in..." : "Sign in →"}
            </Button>
          </form>
        ) : (
          /* CREATE ACCOUNT FORM */
          <form onSubmit={handleSignUpSubmit} className="flex flex-col gap-3.5">
            <div>
              <Label
                htmlFor="sign-up-name"
                className="text-xs font-bold mb-1 block text-[var(--ink)]"
              >
                Display name
              </Label>
              <Input
                id="sign-up-name"
                type="text"
                value={displayName}
                onChange={(e) => handleDisplayNameChange(e.target.value)}
                placeholder="Jude Bellingham"
                required
                autoComplete="name"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <Label
                  htmlFor="sign-up-username"
                  className="text-xs font-bold block text-[var(--ink)]"
                >
                  Username
                </Label>
                <span className="text-[10px] text-[var(--ink-3)]">3–20 chars · immutable</span>
              </div>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--ink-3)] font-mono font-bold text-sm select-none">
                  @
                </span>
                <Input
                  id="sign-up-username"
                  type="text"
                  value={username}
                  onChange={(e) => {
                    setUsernameTouched(true);
                    setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""));
                  }}
                  placeholder="jude_bellingham"
                  required
                  autoComplete="username"
                  className="pl-8"
                />
              </div>
            </div>

            <div>
              <Label
                htmlFor="sign-up-email"
                className="text-xs font-bold mb-1 block text-[var(--ink)]"
              >
                Email
              </Label>
              <Input
                id="sign-up-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jude@bellingham.com"
                required
                autoComplete="email"
              />
            </div>

            <div>
              <Label
                htmlFor="sign-up-password"
                className="text-xs font-bold mb-1 block text-[var(--ink)]"
              >
                Password (min 8 chars)
              </Label>
              <div className="relative">
                <Input
                  id="sign-up-password"
                  type={showPassword ? "text" : "password"}
                  value={signUpPassword}
                  onChange={(e) => setSignUpPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="new-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ink-3)] hover:text-[var(--ink)] cursor-pointer"
                >
                  {showPassword ? (
                    <EyeSlash className="h-4 w-4" weight="bold" />
                  ) : (
                    <Eye className="h-4 w-4" weight="bold" />
                  )}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              variant="lime"
              disabled={submitting}
              className="w-full mt-2 text-sm font-extrabold"
            >
              {submitting ? "Creating account..." : "Create account →"}
            </Button>

            <p className="text-[11px] text-[var(--ink-3)] text-center mt-1 leading-snug">
              No VAR check on your email to read. Confirmation needed only to post debates or vote.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
