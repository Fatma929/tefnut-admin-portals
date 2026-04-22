/**
 * IsoWaterReportPreview
 *
 * Renders a structured preview of an ISO 14046:2014 compliant Water Footprint
 * report, mapped from WaterResult engine output. Covers:
 *   - Organizational description with River Basin + Water Stress Level
 *   - Five water flow categories (Withdrawal, Consumption, Discharge, Recycled, Special)
 *   - Methodology transparency (ISO 14046 + GCCA Water Guidelines)
 *   - Inventory quality / uncertainty assessment
 */
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Download,
  Droplets,
  Info,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import type {
  DataQuality,
  IsoWaterFlowCategory,
  IsoWaterReport,
  WaterStressLevel,
} from "@/lib/engine-types";
import { isoWaterReportToJsonUrl } from "@/lib/iso-water-report";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  report: IsoWaterReport;
}

const qualityConfig: Record<DataQuality, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  High: { label: "High", className: "bg-success/10 text-success border-success/30", icon: CheckCircle2 },
  Medium: { label: "Medium", className: "bg-warning/10 text-warning-foreground border-warning/30", icon: AlertTriangle },
  Low: { label: "Low", className: "bg-destructive/10 text-destructive border-destructive/30", icon: AlertTriangle },
};

const stressConfig: Record<WaterStressLevel, { className: string }> = {
  "Extremely High": { className: "bg-destructive/10 text-destructive border-destructive/30" },
  "High": { className: "bg-warning/10 text-warning-foreground border-warning/30" },
  "Medium-High": { className: "bg-warning/10 text-warning-foreground border-warning/20" },
  "Low-Medium": { className: "bg-info/10 text-info border-info/30" },
  "Low": { className: "bg-success/10 text-success border-success/30" },
};

const flowTypeConfig: Record<IsoWaterFlowCategory["flow_type"], { color: string; bg: string }> = {
  Withdrawal: { color: "text-info", bg: "bg-info/10" },
  Consumption: { color: "text-warning-foreground", bg: "bg-warning/10" },
  Discharge: { color: "text-brand", bg: "bg-brand-muted" },
  Recycled: { color: "text-success", bg: "bg-success/10" },
  Special: { color: "text-muted-foreground", bg: "bg-muted" },
};

function fmt(n: number, decimals = 0) {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function QualityBadge({ quality }: { quality: DataQuality }) {
  const cfg = qualityConfig[quality];
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 text-[10px]", cfg.className)}>
      <Icon className="h-2.5 w-2.5" />
      {cfg.label} quality
    </Badge>
  );
}

function FlowCategoryRow({ cat, isOpen, onToggle }: {
  cat: IsoWaterFlowCategory;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const cfg = flowTypeConfig[cat.flow_type];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-muted/40 transition-colors"
      >
        <div className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          cat.has_data ? cfg.bg : "bg-muted",
        )}>
          <Droplets className={cn("h-4 w-4", cat.has_data ? cfg.color : "text-muted-foreground")} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{cat.label}</p>
            <Badge variant="outline" className={cn("text-[10px]", cat.has_data ? cfg.bg + " " + cfg.color : "")}>
              {cat.flow_type}
            </Badge>
            {!cat.has_data && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">No data</Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{cat.description}</p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-semibold tabular-nums">
              {cat.has_data ? `${fmt(cat.volume_m3)} m³` : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">per year</p>
          </div>
          <QualityBadge quality={cat.data_quality} />
          <ChevronDown className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            isOpen && "rotate-180",
          )} />
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-border bg-muted/20 px-5 pb-4 pt-3">
          <p className="mb-3 text-xs text-muted-foreground">{cat.description}</p>
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Water Sources & Characterisation Factors
            </p>
            {cat.sources.map((src, i) => (
              <div key={i} className="rounded-lg border border-border bg-card px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{src.name}</p>
                    {src.characterisation_factor && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        CF: <span className="font-mono">{src.characterisation_factor}</span>
                        {src.cf_value != null && (
                          <span className="ml-1 font-mono text-info">
                            {src.cf_value} {src.cf_unit}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  <p className="shrink-0 tabular-nums text-sm font-semibold">
                    {src.volume_m3 > 0 ? `${fmt(src.volume_m3)} m³` : "—"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function IsoWaterReportPreview({ report }: Props) {
  const [openFlow, setOpenFlow] = useState<string | null>("Withdrawal");
  const [showUncertainty, setShowUncertainty] = useState(false);

  const handleDownload = () => {
    const url = isoWaterReportToJsonUrl(report);
    const a = document.createElement("a");
    a.href = url;
    a.download = `iso-14046-water-report-${report.audit_hash.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stressCfg = stressConfig[report.organizational_description.water_stress_level];
  const qualityCfg = qualityConfig[report.uncertainty.overall_quality];
  const QualityIcon = qualityCfg.icon;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-info/10 text-info">
            <Droplets className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold tracking-tight">{report.title}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              ISO 14046:2014 · Water Footprint · Generated {new Date(report.generated_at).toLocaleString()}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[10px] bg-info/10 text-info border-info/30">
                GCCA Water Guidelines 2021
              </Badge>
              <Badge variant="outline" className={cn("text-[10px]", stressCfg.className)}>
                Water Stress: {report.organizational_description.water_stress_level}
              </Badge>
              <button
                onClick={() => navigator.clipboard.writeText(report.audit_hash)}
                className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success hover:bg-success/15 transition-colors"
              >
                <ShieldCheck className="h-2.5 w-2.5" />
                SHA-256: {report.audit_hash.slice(0, 8)}…{report.audit_hash.slice(-4)}
              </button>
            </div>
          </div>
        </div>
        <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={handleDownload}>
          <Download className="h-3.5 w-3.5" />
          Download JSON
        </Button>
      </div>

      {/* Organizational Description */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <div className="mb-3 flex items-center gap-2">
          <Info className="h-4 w-4 text-info" />
          <h4 className="text-sm font-semibold">Organizational Description</h4>
          <Badge variant="outline" className="text-[10px]">ISO 14046 §4.1</Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { label: "Reporting Period", value: report.organizational_description.reporting_period },
            { label: "Organizational Boundaries", value: report.organizational_description.organizational_boundaries },
            { label: "Facility Description", value: report.organizational_description.facility_description },
            { label: "River Basin", value: report.organizational_description.river_basin },
            {
              label: "Water Stress Level",
              value: report.organizational_description.water_stress_level,
              badge: stressCfg.className,
            },
            { label: "Stress Data Source", value: report.organizational_description.water_stress_source },
          ].map((item) => (
            <div key={item.label} className="rounded-lg bg-muted/40 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</p>
              {item.badge ? (
                <Badge variant="outline" className={cn("mt-1 text-xs", item.badge)}>{item.value}</Badge>
              ) : (
                <p className="mt-1 text-sm text-foreground">{item.value}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Methodology Transparency */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <div className="mb-3 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-info" />
          <h4 className="text-sm font-semibold">Methodology Transparency</h4>
          <Badge variant="outline" className="text-[10px]">ISO 14046 §5</Badge>
        </div>
        <div className="space-y-2">
          <p className="rounded-lg border border-info/20 bg-info/8 px-4 py-3 text-sm text-foreground">
            {report.methodology.quantification_basis}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg bg-muted/40 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Characterisation Method</p>
              <p className="mt-1 text-sm">{report.methodology.characterisation_method}</p>
            </div>
            <div className="rounded-lg bg-muted/40 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Standards Reference</p>
              <p className="mt-1 text-sm">{report.methodology.standards_reference}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{report.methodology.gcca_reference}</p>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Net Consumption (KPI 1)</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{fmt(report.total_consumption_m3)}</p>
          <p className="text-xs text-muted-foreground">m³ / year</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Water Intensity (KPI 2)</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{fmt(report.water_intensity_l_per_t, 2)}</p>
          <p className="text-xs text-muted-foreground">L / t cementitious</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Freshwater Consumption</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{fmt(report.freshwater_consumption_m3)}</p>
          <p className="text-xs text-muted-foreground">m³ / year (excl. rainwater)</p>
        </div>
      </div>

      {/* Five Water Flow Categories */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <h4 className="text-sm font-semibold">Water Flow Categories</h4>
          <Badge variant="outline" className="text-[10px]">ISO 14046:2014 §6.4</Badge>
        </div>
        <div className="space-y-2">
          {report.flow_categories.map((cat) => (
            <FlowCategoryRow
              key={cat.flow_type}
              cat={cat}
              isOpen={openFlow === cat.flow_type}
              onToggle={() => setOpenFlow(openFlow === cat.flow_type ? null : cat.flow_type)}
            />
          ))}
        </div>
      </div>

      {/* Inventory Quality / Uncertainty */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <button
          onClick={() => setShowUncertainty((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-info" />
            <h4 className="text-sm font-semibold">Inventory Quality & Uncertainty Assessment</h4>
            <Badge variant="outline" className="text-[10px]">ISO 14046 §7</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn("gap-1 text-[10px]", qualityCfg.className)}>
              <QualityIcon className="h-2.5 w-2.5" />
              Overall: {report.uncertainty.overall_quality}
            </Badge>
            <ChevronDown className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              showUncertainty && "rotate-180",
            )} />
          </div>
        </button>

        {showUncertainty && (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-foreground">{report.uncertainty.notes}</p>
            {report.uncertainty.validation_flags.length > 0 ? (
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Validation Flags
                </p>
                <div className="space-y-1">
                  {report.uncertainty.validation_flags.map((flag, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2">
                      <AlertTriangle className="h-3 w-3 shrink-0 text-warning-foreground" />
                      <span className="font-mono text-xs text-foreground">{flag}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/8 px-3 py-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                <span className="text-xs text-foreground">No validation flags — data quality is high.</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
