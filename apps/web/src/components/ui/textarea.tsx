import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, disabled, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        disabled={disabled}
        className={cn(
          "flex min-h-[110px] w-full rounded-sm px-4 py-3 text-base font-sans leading-relaxed",
          "bg-[var(--sunken)] text-[var(--ink)] border-[var(--border-w)] border-[var(--ink)]",
          "placeholder:text-[var(--ink-3)] placeholder:font-normal",
          "transition-all duration-150 ease-out outline-none resize-y",
          "focus-visible:ring-2 focus-visible:ring-[var(--lime)] focus-visible:border-[var(--ink)]",
          "disabled:opacity-40 disabled:pointer-events-none disabled:cursor-not-allowed",
          error && "border-[var(--danger)] focus-visible:ring-[var(--danger)]",
          className
        )}
        {...props}
      />
    );
  }
);

Textarea.displayName = "Textarea";
