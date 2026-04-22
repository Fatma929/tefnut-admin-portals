import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string;
  change?: { value: string; direction: "up" | "down"; positiveIs?: "up" | "down" };
  icon?: LucideIcon;
  hint?: string;
}

export function StatCard({ label, value, change, icon: Icon, hint }: StatCardProps) {
  const positiveIs = change?.positiveIs ?? "up";
  const isPositive = change ? change.direction === positiveIs : false;
  const Arrow = change?.direction === "up" ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-soft transition-all hover:shadow-elevated">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
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
