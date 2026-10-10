import { useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

interface SignInDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message?: string;
  onSuccess?: () => void;
}

export function SignInDialog({
  open,
  onOpenChange,
  message,
  onSuccess,
}: SignInDialogProps) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("referee@varroom.dev");
  const [password, setPassword] = useState("Password123!");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const ok = await signIn(email, password);
      if (ok) {
        onOpenChange(false);
        onSuccess?.();
      } else {
        setError("Invalid email or password. Please verify credentials.");
      }
    } catch (err: any) {
      setError(err.message || "Failed to sign in");
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickDemo = async () => {
    setEmail("referee@varroom.dev");
    setPassword("Password123!");
    setSubmitting(true);
    setError(null);
    try {
      const ok = await signIn("referee@varroom.dev", "Password123!");
      if (ok) {
        onOpenChange(false);
        onSuccess?.();
      } else {
        setError("Could not sign in with demo credentials.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="font-display font-extrabold text-2xl tracking-tight text-[var(--ink)]">
            Sign in to VAR Room
          </DialogTitle>
          <DialogDescription className="text-sm text-[var(--ink-2)]">
            {message ||
              "Authenticated sessions unlock live multi-agent fact-checking, claims breakdown, and persistent referee records."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-3 bg-[var(--danger-soft)] text-[var(--danger)] text-xs font-bold rounded border border-[var(--danger)]">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5 mt-1">
          <div>
            <Label htmlFor="sign-in-email" className="text-xs mb-1 block">
              Email
            </Label>
            <Input
              id="sign-in-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. referee@varroom.dev"
              required
            />
          </div>

          <div>
            <Label htmlFor="sign-in-password" className="text-xs mb-1 block">
              Password
            </Label>
            <Input
              id="sign-in-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <div className="flex flex-col gap-2 mt-2">
            <Button
              type="submit"
              variant="lime"
              disabled={submitting}
              className="w-full text-sm font-bold"
            >
              {submitting ? "Signing in..." : "Sign In →"}
            </Button>

            <Button
              type="button"
              variant="secondary"
              onClick={handleQuickDemo}
              disabled={submitting}
              className="w-full text-xs font-bold border-dashed"
            >
              ⚡ One-Click Demo Referee
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
