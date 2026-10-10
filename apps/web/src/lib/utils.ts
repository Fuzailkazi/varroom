import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Combines class names with tailwind-merge to avoid conflicting tailwind utilities
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
