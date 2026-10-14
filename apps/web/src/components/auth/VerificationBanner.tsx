import { Warning } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export function VerificationBanner({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { user, resendVerificationEmail } = useAuth();
  const [resending, setResending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  if (!user || user.emailVerified) return null;

  const handleResend = async () => {
    setResending(true);
    setStatus(null);
    const ok = await resendVerificationEmail();
    setResending(false);
    if (ok) {
      setStatus(
        import.meta.env.DEV
          ? "A new verification link was printed in the API terminal. No email was sent."
          : "Confirmation email dispatched! Check your spam folder if it doesn't arrive in 60s.",
      );
    } else {
      setStatus(
        import.meta.env.DEV
          ? "Could not print a new verification link. Please try again shortly."
          : "Failed to send verification email. Please try again shortly.",
      );
    }
  };

  return (
    <div className="w-full mb-5 p-3.5 bg-[var(--warning-soft)] text-[var(--ink)] border-[var(--border-w)] border-[var(--warning)] rounded-sm shadow-collapse flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in-50 duration-150">
      <div className="flex items-start gap-2.5">
        <Warning className="h-5 w-5 text-[var(--warning)] shrink-0 mt-0.5" weight="fill" />
        <div>
          <p className="text-xs sm:text-sm font-extrabold text-[var(--ink)] leading-snug">
            Email verification required for debate submissions & voting
          </p>
          <p className="text-xs text-[var(--ink-2)] mt-0.5">
            Account email: <strong className="text-[var(--ink)]">{user.email}</strong>
          </p>
          <p className="text-xs text-[var(--ink-2)] mt-0.5">
            {status ||
              (import.meta.env.DEV
                ? "Development mode prints verification links in the API terminal; no email is sent. Posting stays paused until you open the link."
                : "We sent a link to your account email. Reading is unlocked, but write permissions remain paused.")}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 gap-2">
        <Button type="button" variant="white" size="sm" onClick={() => onNavigate("/account")}>
          Edit email
        </Button>
        <Button
          type="button"
          variant="white"
          size="sm"
          onClick={handleResend}
          disabled={resending}
          className="text-xs font-bold border-[var(--ink)] bg-[var(--surface)] hover:bg-[var(--sunken)]"
        >
          {resending
            ? import.meta.env.DEV
              ? "Printing..."
              : "Sending..."
            : import.meta.env.DEV
              ? "Print new link →"
              : "Resend email →"}
        </Button>
      </div>
    </div>
  );
}
