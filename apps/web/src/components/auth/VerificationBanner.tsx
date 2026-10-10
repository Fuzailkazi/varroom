import { useState } from "react";
import { Warning, CheckCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export function VerificationBanner() {
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
      setStatus("Confirmation email dispatched! Check your spam folder if it doesn't arrive in 60s.");
    } else {
      setStatus("Failed to send verification email. Please try again shortly.");
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
            {status || `We sent a link to ${user.email}. Reading is unlocked, but write permissions remain paused.`}
          </p>
        </div>
      </div>

      <Button
        type="button"
        variant="white"
        size="sm"
        onClick={handleResend}
        disabled={resending}
        className="shrink-0 text-xs font-bold border-[var(--ink)] bg-[var(--surface)] hover:bg-[var(--sunken)]"
      >
        {resending ? "Sending..." : "Resend Link →"}
      </Button>
    </div>
  );
}
