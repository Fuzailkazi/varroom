import * as TabsPrimitive from "@radix-ui/react-tabs";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
} from "react";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-11 items-center justify-start rounded-pill p-1 gap-1",
      "bg-[var(--sunken)] text-[var(--ink)] border-[var(--border-w)] border-[var(--ink)]",
      className
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

export const TabsTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-pill px-4 py-1.5 font-sans text-xs font-bold cursor-pointer select-none",
      "transition-all duration-100 ease-out text-[var(--ink-2)]",
      "hover:text-[var(--ink)]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lime)]",
      "disabled:pointer-events-none disabled:opacity-40",
      "data-[state=active]:bg-[var(--lime)] data-[state=active]:text-[var(--on-lime)] data-[state=active]:border-[var(--border-w)] data-[state=active]:border-[var(--ink)] data-[state=active]:shadow-hard",
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lime)]",
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;
