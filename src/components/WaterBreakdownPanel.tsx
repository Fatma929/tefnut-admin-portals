/**
 * WaterBreakdownPanel
 * Shows water KPIs with a "Water Stress" toggle that switches between
 * Total Consumption view and a detailed Freshwater / Recycled breakdown.
 * Maps directly to water_engine.py output fields.
 */
import { Droplets, Recycle, Waves } from "lucide-react";
import { useState } from "react";
import type { WaterResult } from "@/lib/engine-types";
import { cn } from "@/lib/utils";

interface Props {
  data: WaterResult;
}

type View = "total" | "stress";

function fmt(n: number, decimals = 0) {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

export function WaterBreakdownPanel({ data }: Props) {
  const [view, setView] = useState<View>("total");

  const freshwaterPct =
    data.total_water_withdrawal_m3 > 0
      ? (data.total_freshwater_consumption_m3 / data.total_water_withdrawal_m3) * 100
      : 0;

  const recycledPct =
    data.total_water_withdrawal_m3 > 0
      ? (data.recycled_water_m3 / data.total_water_withdrawal_m3) * 100
      : 0;

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
      {/* Header + toggle */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold tracking-tight">Water KPIs</h3>
          <p className="text-sm text-muted-foreground">
            GCCA Water · {data.methodology.protocol_name} v{data.methodology.protocol_version}
          </p>
        </div>
        <div className="flex rounded-lg border border-border bg-muted p-0.5 text-xs font-medium">
          {(["total", "stress"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "rounded-md px-3 py-1.5 transition-colors",
                view === v
                  ? "bg-card text-foreground shadow-soft"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "total" ? "Overview" : "Water Stress"}
            </button>
          ))}
        </div>
      </div>

      {view === "total" ? (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            {
              label: "Total Withdrawal",
              value: fmt(data.total_water_withdrawal_m3),
              unit: "m³/yr",
              icon: Droplets,
              color: "text-info",
              bg: "bg-info/10",
            },
            {
              label: "Total Discharge",
              value: fmt(data.total_water_discharge_m3),
              unit: "m³/yr",
              icon: Waves,
              color: "text-brand",
              bg: "bg-brand-muted",
            },
            {
              label: "Net Consumption",
              value: fmt(data.total_water_consumption_m3),
              unit: "m³/yr",
              icon: Droplets,
              color: "text-warning-foreground",
              bg: "bg-warning/10",
            },
            {
              label: "Intensity (KPI 2)",
              value: fmt(data.water_consumption_per_tonne_litres, 2),
              unit: "L/t",
              icon: Droplets,
              color: "text-success",
              bg: "bg-success/10",
            },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-xl border border-border bg-muted/30 p-4">
              <div className={cn("mb-2 flex h-8 w-8 items-center justify-center rounded-lg", kpi.bg)}>
                <kpi.icon className={cn("h-4 w-4", kpi.color)} />
              </div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {kpi.label}
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{kpi.value}</p>
              <p className="text-xs text-muted-foreground">{kpi.unit}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {/* Freshwater vs Rainwater bar */}
          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">Freshwater Consumption</span>
              <span className="tabular-nums text-muted-foreground">
                {fmt(data.total_freshwater_consumption_m3)} m³
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-info transition-all"
                style={{ width: `${Math.min(freshwaterPct, 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {freshwaterPct.toFixed(1)}% of total withdrawal · excludes harvested rainwater
            </p>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">Recycled Water</span>
              <span className="tabular-nums text-muted-foreground">
                {fmt(data.recycled_water_m3)} m³
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-success transition-all"
                style={{ width: `${Math.min(recycledPct, 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {recycledPct.toFixed(1)}% of total withdrawal
            </p>
          </div>

          {/* Breakdown table */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="bg-muted/40 px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Special categories
            </div>
            {[
              {
                icon: Droplets,
                label: "Harvested Rainwater",
                value: data.harvested_rainwater_withdrawal_m3,
                color: "text-info",
              },
              {
                icon: Recycle,
                label: "Recycled Water",
                value: data.recycled_water_m3,
                color: "text-success",
              },
              {
                icon: Waves,
                label: "Quarry Water (unused)",
                value: data.quarry_water_not_used_m3,
                color: "text-brand",
              },
              {
                icon: Waves,
                label: "Storm Water Collected",
                value: data.storm_water_collected_discharged_m3,
                color: "text-muted-foreground",
              },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between border-t border-border px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <row.icon className={cn("h-3.5 w-3.5", row.color)} />
                  <span className="text-sm text-foreground">{row.label}</span>
                </div>
                <span className="tabular-nums text-sm font-medium">
                  {fmt(row.value)} m³
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
