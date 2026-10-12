import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", error, disabled, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        disabled={disabled}
        className={cn(
          "flex h-11 w-full rounded-sm px-3.5 py-2 text-base font-sans",
          "bg-[var(--sunken)] text-[var(--ink)] border-[var(--border-w)] border-[var(--ink)]",
          "placeholder:text-[var(--ink-3)] placeholder:font-normal",
          "transition-all duration-150 ease-out outline-none",
          "focus-visible:ring-2 focus-visible:ring-[var(--lime)] focus-visible:border-[var(--ink)]",
          "disabled:opacity-40 disabled:pointer-events-none disabled:cursor-not-allowed",
          error && "border-[var(--danger)] focus-visible:ring-[var(--danger)]",
          className,
        )}
        {...props}
      />
    );
  },
);

Input.displayName = "Input";
