import { ArrowDownRight, ArrowUpRight, ShieldCheck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface VerifiedMeta {
  inputHash: string;
  methodology: string;
  timestamp: string;
}

interface StatCardProps {
  label: string;
  value: string;
  change?: { value: string; direction: "up" | "down"; positiveIs?: "up" | "down" };
  icon?: LucideIcon;
  hint?: string;
  /** When provided, renders an inline verified badge next to the KPI value */
  verified?: VerifiedMeta;
}

export function StatCard({ label, value, change, icon: Icon, hint, verified }: StatCardProps) {
  const positiveIs = change?.positiveIs ?? "up";
  const isPositive = change ? change.direction === positiveIs : false;
  const Arrow = change?.direction === "up" ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-soft transition-all hover:shadow-elevated">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <p className="text-2xl font-semibold tracking-tight text-foreground">{value}</p>
            {verified && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-default items-center gap-1 rounded-full border border-success/30 bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
                      <ShieldCheck className="h-2.5 w-2.5" />
                      Verified
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    <p className="text-xs font-semibold">Data integrity verified via SHA-256</p>
                    <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                      {verified.inputHash}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {verified.methodology} · {new Date(verified.timestamp).toLocaleString()}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
        {Icon && (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-muted text-brand">
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
      {(change || hint) && (
        <div className="mt-3 flex items-center gap-2 text-xs">
          {change && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium",
                isPositive
                  ? "bg-success/10 text-success"
                  : "bg-destructive/10 text-destructive",
              )}
            >
              <Arrow className="h-3 w-3" />
              {change.value}
            </span>
          )}
          {hint && <span className="text-muted-foreground">{hint}</span>}
        </div>
      )}
    </div>
  );
}
