import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  variant?:
    | "default"
    | "secondary"
    | "outline"
    | "success"
    | "stands"
    | "destructive"
    | "overturned"
    | "warning"
    | "incomplete"
    | "live"
    | "violet";
}

export function Badge({
  className,
  variant = "default",
  ...props
}: BadgeProps) {
  const variantStyles: Record<string, string> = {
    default:
      "bg-[var(--sunken)] text-[var(--ink)] border-[var(--ink)]",
    secondary:
      "bg-[var(--surface)] text-[var(--ink)] border-[var(--ink)]",
    outline:
      "border-[var(--ink)] text-[var(--ink)] bg-transparent",
    success:
      "bg-[var(--lime)] text-[var(--on-lime)] border-[var(--ink)]",
    stands:
      "bg-[var(--lime)] text-[var(--on-lime)] border-[var(--ink)]",
    destructive:
      "bg-[var(--danger-soft)] text-[var(--danger)] border-[var(--danger)]",
    overturned:
      "bg-[var(--danger-soft)] text-[var(--danger)] border-[var(--danger)]",
    warning:
      "bg-[var(--warning-soft)] text-[var(--warning)] border-[var(--warning)]",
    incomplete:
      "bg-[var(--warning-soft)] text-[var(--warning)] border-[var(--warning)]",
    live:
      "bg-[var(--violet-soft)] text-[var(--violet)] border-[var(--violet)]",
    violet:
      "bg-[var(--violet-soft)] text-[var(--violet)] border-[var(--violet)]",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-pill border-[var(--border-w)] px-2.5 py-0.5 font-display text-[11px] font-extrabold uppercase tracking-wider transition-colors select-none",
        variantStyles[variant] || variantStyles.default,
        className
      )}
      {...props}
    />
  );
}
