import { cn } from "@/lib/utils";

interface TefnutLogoProps {
  className?: string;
  showText?: boolean;
  variant?: "default" | "light";
}

export function TefnutLogo({ className, showText = true, variant = "default" }: TefnutLogoProps) {
  const textColor = variant === "light" ? "text-primary-foreground" : "text-foreground";
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="relative flex h-9 w-9 items-center justify-center rounded-xl gradient-brand shadow-glow">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 text-white"
          aria-hidden="true"
        >
          <path
            d="M12 2C12 2 5 9 5 14a7 7 0 0014 0c0-5-7-12-7-12z"
            fill="currentColor"
            opacity="0.9"
          />
          <path
            d="M12 8c-1.5 2-3 4-3 6a3 3 0 006 0c0-2-1.5-4-3-6z"
            fill="white"
            opacity="0.4"
          />
        </svg>
      </div>
      {showText && (
        <div className="flex flex-col leading-none">
          <span className={cn("text-lg font-semibold tracking-tight", textColor)}>Tefnut</span>
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Sustainability
          </span>
        </div>
      )}
    </div>
  );
}
