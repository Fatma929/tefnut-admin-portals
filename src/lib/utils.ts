import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats a number as a EUR currency string.
 * Examples: 1234.5 → "€1,234.50", 0 → "€0.00"
 */
export function formatEUR(value: number): string {
  return "€" + value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
