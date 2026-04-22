/**
 * VerifiedBadge
 * Displays a "Verified by Tefnut" lock badge with the SHA-256 audit hash.
 * Clicking it copies the hash to clipboard and shows a tooltip.
 */
import { CheckCircle2, Copy, Lock, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  inputHash: string;
  methodology: string;
  timestamp: string;
  /** "badge" = compact inline chip, "card" = expanded panel */
  variant?: "badge" | "card";
}

export function VerifiedBadge({
  inputHash,
  methodology,
  timestamp,
  variant = "badge",
}: Props) {
  const [copied, setCopied] = useState(false);
  const shortHash = inputHash.slice(0, 8) + "…" + inputHash.slice(-4);

  const handleCopy = () => {
    navigator.clipboard.writeText(inputHash).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (variant === "badge") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-medium text-success transition-colors hover:bg-success/15"
            >
              <ShieldCheck className="h-3 w-3" />
              Verified by Tefnut
              <span className="font-mono opacity-70">{shortHash}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="text-xs font-medium">SHA-256 Audit Hash</p>
            <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
              {inputHash}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {methodology} · {new Date(timestamp).toLocaleString()}
            </p>
            <p className="mt-1 text-[10px] text-brand">Click to copy full hash</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Card variant — used in report footers
  return (
    <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/8 p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success">
        <Lock className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-foreground">Verified by Tefnut</p>
          <CheckCircle2 className="h-4 w-4 text-success" />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {methodology} · Calculated {new Date(timestamp).toLocaleString()}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground">
            {inputHash}
          </code>
          <button
            onClick={handleCopy}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors",
              copied
                ? "text-success"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {copied ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
