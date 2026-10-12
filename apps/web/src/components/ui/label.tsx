import * as LabelPrimitive from "@radix-ui/react-label";
import { type ComponentPropsWithoutRef, forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Label = forwardRef<
  HTMLLabelElement,
  ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      "font-display text-base font-bold text-[var(--ink)] select-none leading-none",
      className,
    )}
    {...props}
  />
));

Label.displayName = "Label";
