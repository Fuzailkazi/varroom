import { CaretDown, PencilSimple, ShieldCheck, SignOut } from "@phosphor-icons/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";

export function UserMenu({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { user, signOut, signOutEverywhere } = useAuth();

  if (!user) return null;

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
            {user.tacticalIqScore != null ? `${user.tacticalIqScore} IQ` : "UNRATED"}
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
              <span className="text-[10px] font-bold text-[var(--ink-3)]">{user.role}</span>
            </div>
          </div>
        </DropdownMenuLabel>

        {/* ACTIONS */}
        <div className="pt-1">
          <DropdownMenuItem
            onClick={() => onNavigate("/account")}
            className="flex items-center gap-2 cursor-pointer text-xs font-bold"
          >
            <PencilSimple className="h-3.5 w-3.5" weight="bold" />
            <span>Edit account</span>
          </DropdownMenuItem>
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
