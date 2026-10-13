import { CheckCircle, Eye, EyeSlash, WarningCircle } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

interface ResetPasswordViewProps {
  token?: string;
  onNavigate: (path: string) => void;
}

export function ResetPasswordView({ token, onNavigate }: ResetPasswordViewProps) {
  const { resetPassword } = useAuth();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fallback token extraction from window location if prop not provided
  const resolvedToken =
    token ||
    (typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("token") ||
        window.location.pathname.match(/^\/reset-password\/([^/?]+)/)?.[1]
      : undefined);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!resolvedToken) {
      setError("Missing reset token. Please request a new reset link.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match. Please re-enter.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const res = await resetPassword(resolvedToken, newPassword);
    setSubmitting(false);

    if (res.success) {
      setSuccess(true);
    } else {
      setError(res.error || "Failed to reset password. Link may be expired.");
    }
  };

  if (!resolvedToken) {
    return (
      <div className="flex flex-col items-center justify-center pt-2 pb-12 animate-in fade-in-50 duration-200">
        <div className="auth-form-card max-w-[520px]">
          <div className="flex items-start gap-2.5 p-3.5 bg-[var(--danger-soft)] text-[var(--danger)] text-xs font-bold rounded-sm border border-[var(--danger)] mb-4">
            <WarningCircle className="h-5 w-5 shrink-0 mt-0.5" weight="bold" />
            <div>
              <p className="font-bold text-sm">No reset token detected</p>
              <p className="mt-1 font-normal">
                This reset link appears invalid or incomplete. Please request a fresh reset link.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="lime"
            onClick={() => onNavigate("/forgot-password")}
            className="w-full text-sm font-extrabold"
          >
            Request New Reset Link →
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center pt-2 pb-12 animate-in fade-in-50 duration-200">
      <div className="auth-form-card max-w-[520px]">
        <div className="mb-5 text-left">
          <h1 className="font-display font-extrabold text-2xl tracking-tight text-[var(--ink)]">
            Create new password
          </h1>
          <p className="text-xs sm:text-sm text-[var(--ink-2)] mt-1 leading-relaxed">
            Choose a strong password (at least 8 characters). Saving will sign out all your active
            devices.
          </p>
        </div>

        {success ? (
          <div className="flex flex-col gap-4 text-left">
            <div className="flex items-start gap-2.5 p-3.5 bg-[var(--sunken)] rounded-sm border border-[var(--border-w)] border-[var(--ink)]">
              <CheckCircle className="h-5 w-5 text-[var(--lime)] shrink-0 mt-0.5" weight="fill" />
              <div>
                <p className="text-sm font-bold text-[var(--ink)] leading-snug">
                  Password updated!
                </p>
                <p className="text-xs text-[var(--ink-2)] mt-1">
                  Your password was successfully changed. All other device sessions have been
                  revoked.
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="lime"
              onClick={() => onNavigate("/sign-in")}
              className="w-full mt-2 text-sm font-extrabold"
            >
              Sign In with New Password →
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
                htmlFor="new-password"
                className="text-xs font-bold mb-1.5 block text-[var(--ink)]"
              >
                New Password (min 8 characters)
              </Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
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

            <div>
              <Label
                htmlFor="confirm-password"
                className="text-xs font-bold mb-1.5 block text-[var(--ink)]"
              >
                Confirm New Password
              </Label>
              <Input
                id="confirm-password"
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="new-password"
              />
            </div>

            <Button
              type="submit"
              variant="lime"
              disabled={submitting}
              className="w-full mt-2 text-sm font-extrabold"
            >
              {submitting ? "Updating password..." : "Update Password →"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
