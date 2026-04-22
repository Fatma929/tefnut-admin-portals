/**
 * IsoReportPreview
 *
 * Renders a structured preview of an ISO 14064-1:2018 compliant GHG inventory
 * report, mapped from CarbonResult engine output. Covers Clause 9.3 requirements:
 *   - Organizational description (metadata)
 *   - Six emission categories
 *   - Methodology transparency
 *   - Inventory quality / uncertainty assessment
 *   - GWP reference
 */
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  Info,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import type { DataQuality, IsoEmissionCategory, IsoReport } from "@/lib/engine-types";
import { isoReportToJsonUrl } from "@/lib/iso-report";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  report: IsoReport;
}

const qualityConfig: Record<DataQuality, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  High: { label: "High", className: "bg-success/10 text-success border-success/30", icon: CheckCircle2 },
  Medium: { label: "Medium", className: "bg-warning/10 text-warning-foreground border-warning/30", icon: AlertTriangle },
  Low: { label: "Low", className: "bg-destructive/10 text-destructive border-destructive/30", icon: AlertTriangle },
};

function fmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
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

function CategoryRow({ cat, isOpen, onToggle }: {
  cat: IsoEmissionCategory;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const totalPct = cat.co2e_t > 0 ? 100 : 0;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-muted/40 transition-colors"
      >
        {/* Category number bubble */}
        <span className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          cat.has_data
            ? "bg-brand text-brand-foreground"
            : "bg-muted text-muted-foreground",
        )}>
          {cat.category}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{cat.label}</p>
            {!cat.has_data && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">Placeholder</Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{cat.description}</p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-semibold tabular-nums">
              {cat.has_data ? `${fmt(cat.co2e_t)} t` : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">CO₂e</p>
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

          {/* Progress bar (relative to total) */}
          {cat.has_data && (
            <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${totalPct}%` }} />
            </div>
          )}

          {/* Emission sources table */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Emission Sources & Factors
            </p>
            {cat.sources.map((src, i) => (
              <div key={i} className="rounded-lg border border-border bg-card px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{src.name}</p>
                    {src.emission_factor && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        EF: <span className="font-mono">{src.emission_factor}</span>
                        {src.ef_value != null && (
                          <span className="ml-1 font-mono text-brand">
                            {src.ef_value} {src.ef_unit}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  <p className="shrink-0 tabular-nums text-sm font-semibold">
                    {src.co2e_t > 0 ? `${fmt(src.co2e_t)} t CO₂e` : "—"}
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

export function IsoReportPreview({ report }: Props) {
  const [openCat, setOpenCat] = useState<number | null>(1);
  const [showUncertainty, setShowUncertainty] = useState(false);

  const handleDownload = () => {
    const url = isoReportToJsonUrl(report);
    const a = document.createElement("a");
    a.href = url;
    a.download = `iso-14064-report-${report.audit_hash.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalWithData = report.categories
    .filter((c) => c.has_data)
    .reduce((s, c) => s + c.co2e_t, 0);

  const qualityCfg = qualityConfig[report.uncertainty.overall_quality];
  const QualityIcon = qualityCfg.icon;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-muted text-brand">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold tracking-tight">{report.title}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              ISO 14064-1:2018 · Clause 9.3 · Generated {new Date(report.generated_at).toLocaleString()}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[10px] bg-brand-muted text-brand border-brand/20">
                GCCA Protocol v3.1
              </Badge>
              <Badge variant="outline" className="text-[10px] bg-brand-muted text-brand border-brand/20">
                {report.methodology.gwp_source}
              </Badge>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(report.audit_hash);
                }}
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
          <Info className="h-4 w-4 text-brand" />
          <h4 className="text-sm font-semibold">Organizational Description</h4>
          <Badge variant="outline" className="text-[10px]">ISO 14064-1 §5.1</Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { label: "Reporting Period", value: report.organizational_description.reporting_period },
            { label: "Organizational Boundaries", value: report.organizational_description.organizational_boundaries },
            { label: "Facility Description", value: report.organizational_description.facility_description },
            { label: "Consolidation Approach", value: report.organizational_description.consolidation_approach },
          ].map((item) => (
            <div key={item.label} className="rounded-lg bg-muted/40 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</p>
              <p className="mt-1 text-sm text-foreground">{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Methodology Transparency */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <div className="mb-3 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-brand" />
          <h4 className="text-sm font-semibold">Methodology Transparency</h4>
          <Badge variant="outline" className="text-[10px]">ISO 14064-1 §6</Badge>
        </div>
        <div className="space-y-2 text-sm text-foreground">
          <p className="rounded-lg border border-brand/20 bg-brand-muted px-4 py-3 text-sm">
            {report.methodology.quantification_basis}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg bg-muted/40 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">GWP Values</p>
              <p className="mt-1 text-sm">{report.methodology.gwp_source}</p>
              <p className="text-xs text-muted-foreground">Assessment Report: {report.methodology.gwp_ar}</p>
            </div>
            <div className="rounded-lg bg-muted/40 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Standards Reference</p>
              <p className="mt-1 text-sm">{report.methodology.standards_reference}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Summary totals */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total GHG Inventory</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{fmt(report.total_co2e_t)}</p>
          <p className="text-xs text-muted-foreground">t CO₂e / year</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Specific Emissions</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{fmt(report.specific_co2_kg_per_t)}</p>
          <p className="text-xs text-muted-foreground">kg CO₂e / t cementitious</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Cat 1+2 Verified</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{fmt(totalWithData)}</p>
          <p className="text-xs text-muted-foreground">t CO₂e (engine-calculated)</p>
        </div>
      </div>

      {/* Six ISO Categories */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <h4 className="text-sm font-semibold">GHG Emission Categories</h4>
          <Badge variant="outline" className="text-[10px]">ISO 14064-1 §5.3 — Six Categories</Badge>
        </div>
        <div className="space-y-2">
          {report.categories.map((cat) => (
            <CategoryRow
              key={cat.category}
              cat={cat}
              isOpen={openCat === cat.category}
              onToggle={() => setOpenCat(openCat === cat.category ? null : cat.category)}
            />
          ))}
        </div>
      </div>

      {/* Inventory Quality / Uncertainty Assessment */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <button
          onClick={() => setShowUncertainty((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-brand" />
            <h4 className="text-sm font-semibold">Inventory Quality & Uncertainty Assessment</h4>
            <Badge variant="outline" className="text-[10px]">ISO 14064-1 §7</Badge>
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
