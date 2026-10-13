import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

// Spotlight adapted for VAR Room from Aceternity UI's Spotlight pattern.
// https://ui.aceternity.com/components/spotlight
export function Spotlight({ children, className }: { children: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = root.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const move = (event: PointerEvent) => {
      const bounds = element.getBoundingClientRect();
      element.style.setProperty("--spot-x", `${event.clientX - bounds.left}px`);
      element.style.setProperty("--spot-y", `${event.clientY - bounds.top}px`);
    };
    element.addEventListener("pointermove", move);
    return () => element.removeEventListener("pointermove", move);
  }, []);

  return (
    <div ref={root} className={cn("var-spotlight", className)}>
      <div className="var-spotlight-glow" aria-hidden="true" />
      {children}
    </div>
  );
}
