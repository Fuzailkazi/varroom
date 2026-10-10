import { useState } from "react";
import { SignOut, ShieldCheck, Warning, CaretDown } from "@phosphor-icons/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";

interface UserMenuProps {
  onNavigate?: (path: string) => void;
}

export function UserMenu({ onNavigate }: UserMenuProps) {
  const { user, signOut, signOutEverywhere, resendVerificationEmail } = useAuth();
  const [resending, setResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<string | null>(null);

  if (!user) return null;

  const handleResend = async () => {
    setResending(true);
    setResendStatus(null);
    const ok = await resendVerificationEmail();
    setResending(false);
    if (ok) {
      setResendStatus("Link dispatched!");
      setTimeout(() => setResendStatus(null), 4000);
    } else {
      setResendStatus("Failed to resend");
      setTimeout(() => setResendStatus(null), 4000);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="User account menu"
          className="inline-flex items-center gap-2 bg-[var(--surface)] text-[var(--ink)] border-[var(--border-w)] border-[var(--ink)] px-2.5 py-1 rounded-pill text-xs font-bold cursor-pointer shadow-collapse hover:bg-[var(--sunken)] active:translate-x-[1px] active:translate-y-[1px] select-none"
        >
          <span className="font-mono text-xs font-extrabold text-[var(--ink)]">
            @{user.displayUsername || user.username}
          </span>
          <span className="bg-[var(--lime)] text-[var(--on-lime)] font-mono text-[10px] font-extrabold px-1.5 py-0.2 rounded-pill border border-[var(--ink)]">
            {user.tacticalIqScore || 50} IQ
          </span>
          <CaretDown className="h-3 w-3 text-[var(--ink-2)]" weight="bold" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56 p-2">
        {/* PROFILE HEADER */}
        <DropdownMenuLabel className="pb-2 border-b border-[var(--line)]">
          <div className="flex flex-col">
            <span className="font-display font-extrabold text-sm text-[var(--ink)] tracking-tight">
              {user.displayName}
            </span>
            <span className="font-mono text-xs text-[var(--ink-2)] lowercase">
              @{user.username}
            </span>
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded-pill bg-[var(--sunken)] text-[var(--ink-2)] border border-[var(--line)]">
                {user.badge || "SPECTATOR"}
              </span>
              <span className="text-[10px] font-bold text-[var(--ink-3)]">
                {user.role}
              </span>
            </div>
          </div>
        </DropdownMenuLabel>

        {/* VERIFICATION ALERT IF UNVERIFIED */}
        {!user.emailVerified && (
          <div className="p-2 my-1 bg-[var(--warning-soft)] text-[var(--ink)] rounded-sm border border-[var(--warning)] text-xs">
            <div className="flex items-center gap-1 font-bold text-[var(--ink)] mb-1">
              <Warning className="h-3.5 w-3.5 text-[var(--warning)]" weight="fill" />
              <span>Email unverified</span>
            </div>
            <p className="text-[10px] text-[var(--ink-2)] leading-tight mb-1.5">
              Confirm your email to post debates & vote.
            </p>
            <button
              type="button"
              onClick={handleResend}
              disabled={resending}
              className="w-full text-center text-[10px] font-extrabold bg-[var(--surface)] text-[var(--ink)] border border-[var(--ink)] rounded-pill py-0.5 hover:bg-[var(--sunken)] cursor-pointer"
            >
              {resending ? "Sending..." : resendStatus || "Resend confirmation email"}
            </button>
          </div>
        )}

        {/* ACTIONS */}
        <div className="pt-1">
          <DropdownMenuItem
            onClick={() => signOut()}
            className="flex items-center gap-2 cursor-pointer text-xs font-bold"
          >
            <SignOut className="h-3.5 w-3.5" weight="bold" />
            <span>Sign Out</span>
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => signOutEverywhere()}
            className="flex items-center gap-2 cursor-pointer text-xs text-[var(--ink-2)] hover:text-[var(--danger)]"
          >
            <ShieldCheck className="h-3.5 w-3.5" weight="bold" />
            <span>Sign Out All Devices</span>
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
