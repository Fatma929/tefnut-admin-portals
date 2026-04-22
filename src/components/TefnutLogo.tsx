import { cn } from "@/lib/utils";
import logoUrl from "@/assets/tefnut-logo.png";

interface TefnutLogoProps {
  className?: string;
  showText?: boolean;
  variant?: "default" | "light";
}

export function TefnutLogo({ className, showText = true }: TefnutLogoProps) {
  // The provided artwork already contains the "Tefnut" wordmark, so when
  // showText is true we render the full lockup; otherwise just the mark.
  return (
    <div className={cn("flex items-center", className)}>
      <img
        src={logoUrl}
        alt="Tefnut — Sustainability & CBAM compliance"
        className={cn(
          "w-auto select-none",
          showText ? "h-9" : "h-9 object-cover object-top",
        )}
        style={showText ? undefined : { aspectRatio: "1 / 1", objectPosition: "top" }}
        draggable={false}
      />
    </div>
  );
}
