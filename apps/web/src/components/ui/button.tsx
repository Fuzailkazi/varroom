import { Slot } from "@radix-ui/react-slot";
import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "default"
    | "secondary"
    | "lime"
    | "white"
    | "violet"
    | "destructive"
    | "outline"
    | "ghost";
  size?: "sm" | "md" | "lg";
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", asChild = false, disabled, ...props }, ref) => {
    const Component = asChild ? Slot : "button";

    const variantStyles: Record<string, string> = {
      default: "bg-[var(--lime)] text-[var(--on-lime)] hover:bg-[var(--lime-hover)]",
      lime: "bg-[var(--lime)] text-[var(--on-lime)] hover:bg-[var(--lime-hover)]",
      secondary: "bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--sunken)]",
      white: "bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--sunken)]",
      violet: "bg-[var(--violet)] text-white hover:opacity-90",
      destructive: "bg-[var(--danger)] text-white hover:opacity-90 border-[var(--danger)]",
      outline: "bg-transparent text-[var(--ink)] hover:bg-[var(--sunken)]",
      ghost:
        "bg-transparent text-[var(--ink)] border-transparent shadow-none hover:bg-[var(--sunken)] hover:shadow-none hover:translate-x-0 hover:translate-y-0 active:translate-x-0 active:translate-y-0 active:shadow-none",
    };

    const sizeStyles = {
      sm: "h-8 px-3.5 text-xs gap-1.5",
      md: "h-11 px-5 text-sm gap-2",
      lg: "h-13 px-6 py-3.5 text-base gap-2.5",
    };

    const isGhost = variant === "ghost";

    return (
      <Component
        ref={ref}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center font-sans font-bold cursor-pointer rounded-pill select-none transition-all duration-100 ease-out",
          !isGhost &&
            "border-[var(--border-w)] border-[var(--ink)] shadow-hard hover:shadow-hard-lg hover:-translate-x-[1px] hover:-translate-y-[1px] active:translate-x-[2px] active:translate-y-[2px] active:shadow-collapse",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lime)] focus-visible:ring-offset-2",
          "disabled:opacity-40 disabled:pointer-events-none disabled:cursor-not-allowed",
          variantStyles[variant] || variantStyles.default,
          sizeStyles[size],
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
