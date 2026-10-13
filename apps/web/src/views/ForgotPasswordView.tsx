import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

interface ForgotPasswordViewProps {
  onNavigate: (path: string) => void;
}

export function ForgotPasswordView({ onNavigate }: ForgotPasswordViewProps) {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const res = await requestPasswordReset(email);
    setSubmitting(false);

    if (res.success) {
      setSubmitted(true);
    } else {
      setError(res.error || "Could not request password reset. Try again.");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center pt-2 pb-12 animate-in fade-in-50 duration-200">
      <div className="auth-form-card max-w-[520px]">
        <div className="mb-5 text-left">
          <h1 className="font-display font-extrabold text-2xl tracking-tight text-[var(--ink)]">
            Reset your password
          </h1>
          <p className="text-xs sm:text-sm text-[var(--ink-2)] mt-1 leading-relaxed">
            Enter the email attached to your pundit account to receive a secure reset link.
          </p>
        </div>

        {submitted ? (
          <div className="flex flex-col gap-4 text-left">
            <div className="flex items-start gap-2.5 p-3.5 bg-[var(--sunken)] rounded-sm border border-[var(--border-w)] border-[var(--ink)]">
              <CheckCircle className="h-5 w-5 text-[var(--lime)] shrink-0 mt-0.5" weight="fill" />
              <div>
                <p className="text-sm font-bold text-[var(--ink)] leading-snug">
                  Reset link dispatched!
                </p>
                <p className="text-xs text-[var(--ink-2)] mt-1">
                  We sent a link to <span className="font-bold text-[var(--ink)]">{email}</span>.
                  Open it to set your new password.
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="lime"
              onClick={() => onNavigate("/sign-in")}
              className="w-full mt-2 text-sm font-extrabold"
            >
              Back to Sign In →
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <div className="flex items-start gap-2.5 p-3 bg-[var(--danger-soft)] text-[var(--danger)] text-xs font-bold rounded-sm border border-[var(--danger)]">
                <WarningCircle className="h-4 w-4 shrink-0 mt-0.5" weight="bold" />
                <div className="leading-tight">{error}</div>
              </div>
            )}

            <div>
              <Label
                htmlFor="reset-email"
                className="text-xs font-bold mb-1.5 block text-[var(--ink)]"
              >
                Account Email
              </Label>
              <Input
                id="reset-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="pundit@varroom.dev"
                required
                autoComplete="email"
              />
            </div>

            <Button
              type="submit"
              variant="lime"
              disabled={submitting}
              className="w-full mt-2 text-sm font-extrabold"
            >
              {submitting ? "Sending link..." : "Send reset link →"}
            </Button>

            <button
              type="button"
              onClick={() => onNavigate("/sign-in")}
              className="text-xs font-bold text-[var(--ink-2)] hover:text-[var(--ink)] underline cursor-pointer text-center mt-1"
            >
              Back to Sign In
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
