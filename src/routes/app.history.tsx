import { createFileRoute } from "@tanstack/react-router";
import {
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Droplets,
  FileText,
  Leaf,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fetchReportHistory } from "@/lib/engine-api";
import type { GeneratedReport } from "../../db/schema";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/history")({
  head: () => ({ meta: [{ title: "Report History — Tefnut" }] }),
  component: HistoryPage,
});

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------
const statusConfig: Record<GeneratedReport["status"], {
  label: string;
  className: string;
  icon: typeof CheckCircle2;
}> = {
  draft: { label: "Draft", className: "bg-warning/10 text-warning-foreground border-warning/30", icon: Clock },
  under_review: { label: "Under Review", className: "bg-info/10 text-info border-info/30", icon: Clock },
  approved: { label: "Approved", className: "bg-success/10 text-success border-success/30", icon: CheckCircle2 },
  submitted: { label: "Submitted", className: "bg-success/10 text-success border-success/30", icon: Send },
  archived: { label: "Archived", className: "bg-muted text-muted-foreground border-border", icon: FileText },
};

const reportTypeConfig: Record<string, { label: string; icon: typeof Leaf; accent: string }> = {
  iso_14064_ghg_inventory: { label: "ISO 14064 — Carbon", icon: Leaf, accent: "text-success" },
  iso_14046_water_footprint: { label: "ISO 14046 — Water", icon: Droplets, accent: "text-info" },
  cbam_quarterly: { label: "CBAM Quarterly", icon: FileText, accent: "text-brand" },
  cbam_annual: { label: "CBAM Annual", icon: FileText, accent: "text-brand" },
  esg_disclosure: { label: "ESG Disclosure", icon: FileText, accent: "text-muted-foreground" },
  combined_sustainability: { label: "Combined Report", icon: FileText, accent: "text-muted-foreground" },
};

// ---------------------------------------------------------------------------
// Mock data — shown when D1 is not yet connected
// ---------------------------------------------------------------------------
const MOCK_REPORTS: GeneratedReport[] = [
  {
    id: "r001",
    facility_id: "default",
    generated_by: "layla.hassan",
    report_type: "iso_14064_ghg_inventory",
    reporting_year: 2026,
    reporting_period_start: "2026-01-01",
    reporting_period_end: "2026-12-31",
    title: "GHG Inventory Report — Cement Plant Suez — 2026",
    sha256_hash: "a3f8c2d1e9b047f6a1c3d5e7f9b2a4c6d8e0f2a4b6c8d0e2f4a6b8c0d2e4f6a8",
    report_json: "{}",
    storage_key: null,
    standards_cited: '["iso-14064","gcca-carbon","ipcc-ar6"]',
    status: "approved",
    submitted_at: null,
    submission_ref: null,
    generated_at: "2026-04-22T10:30:00Z",
    carbon_record_ids: '["c001","c002","c003"]',
    water_record_ids: "[]",
  },
  {
    id: "r002",
    facility_id: "default",
    generated_by: "layla.hassan",
    report_type: "iso_14046_water_footprint",
    reporting_year: 2026,
    reporting_period_start: "2026-01-01",
    reporting_period_end: "2026-12-31",
    title: "Water Footprint Report — Cement Plant Suez — 2026",
    sha256_hash: "b4e9d3c2f0a158e7b2d4f6a8c0e2f4a6b8d0e2f4a6b8c0d2e4f6a8b0c2d4e6f8",
    report_json: "{}",
    storage_key: null,
    standards_cited: '["iso-14046","gcca-water"]',
    status: "draft",
    submitted_at: null,
    submission_ref: null,
    generated_at: "2026-04-22T10:35:00Z",
    carbon_record_ids: "[]",
    water_record_ids: '["w001","w002","w003"]',
  },
  {
    id: "r003",
    facility_id: "default",
    generated_by: "layla.hassan",
    report_type: "cbam_quarterly",
    reporting_year: 2026,
    reporting_period_start: "2026-01-01",
    reporting_period_end: "2026-03-31",
    title: "Q1 2026 — CBAM Quarterly Report",
    sha256_hash: "c5f0e4d3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5",
    report_json: "{}",
    storage_key: null,
    standards_cited: '["iso-14064","eu-cbam"]',
    status: "submitted",
    submitted_at: "2026-04-15T09:00:00Z",
    submission_ref: "EU-CBAM-2026-Q1-EG-001",
    generated_at: "2026-04-10T14:20:00Z",
    carbon_record_ids: '["c001"]',
    water_record_ids: "[]",
  },
];

// ---------------------------------------------------------------------------
// HistoryPage
// ---------------------------------------------------------------------------
function HistoryPage() {
  const [reports, setReports] = useState<GeneratedReport[]>(MOCK_REPORTS);
  const [loading, setLoading] = useState(false);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [yearFilter, setYearFilter] = useState<number | undefined>(undefined);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const data = await fetchReportHistory("default", yearFilter);
      if (data.reports.length > 0) setReports(data.reports);
    } catch {
      // D1 not connected yet — keep mock data
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadHistory(); }, [yearFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const copyHash = (hash: string) => {
    navigator.clipboard.writeText(hash).then(() => {
      setCopiedHash(hash);
      setTimeout(() => setCopiedHash(null), 2000);
    });
  };

  const downloadReport = (report: GeneratedReport) => {
    const blob = new Blob([report.report_json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report.id}-${report.sha256_hash.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalVerified = reports.filter((r) => r.status === "approved" || r.status === "submitted").length;
  const totalDraft = reports.filter((r) => r.status === "draft" || r.status === "under_review").length;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Audit Trail"
        title="Report History"
        description="All generated ISO reports with their SHA-256 audit hashes and status."
        actions={
          <Button variant="outline" size="sm" onClick={loadHistory} disabled={loading}>
            <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      {/* Summary stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Total Reports</p>
          <p className="mt-2 text-2xl font-semibold">{reports.length}</p>
        </div>
        <div className="rounded-2xl border border-success/30 bg-success/5 p-5 shadow-soft">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Verified / Submitted</p>
          <div className="mt-2 flex items-center gap-2">
            <p className="text-2xl font-semibold">{totalVerified}</p>
            <ShieldCheck className="h-5 w-5 text-success" />
          </div>
        </div>
        <div className="rounded-2xl border border-warning/30 bg-warning/5 p-5 shadow-soft">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Draft / In Review</p>
          <p className="mt-2 text-2xl font-semibold">{totalDraft}</p>
        </div>
      </div>

      {/* Year filter */}
      <div className="mt-6 flex items-center gap-2">
        <p className="text-sm text-muted-foreground">Filter by year:</p>
        {[undefined, 2026, 2025, 2024].map((y) => (
          <button
            key={String(y)}
            onClick={() => setYearFilter(y)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              yearFilter === y
                ? "border-brand bg-brand-muted text-brand"
                : "border-border text-muted-foreground hover:border-brand hover:text-foreground",
            )}
          >
            {y ?? "All"}
          </button>
        ))}
      </div>

      {/* Report list */}
      <div className="mt-4 space-y-3">
        {reports.map((report) => {
          const statusCfg = statusConfig[report.status];
          const typeCfg = reportTypeConfig[report.report_type] ?? reportTypeConfig.esg_disclosure;
          const StatusIcon = statusCfg.icon;
          const TypeIcon = typeCfg.icon;
          const shortHash = report.sha256_hash.slice(0, 8) + "…" + report.sha256_hash.slice(-4);
          const isCopied = copiedHash === report.sha256_hash;
          const standards: string[] = JSON.parse(report.standards_cited || "[]");

          return (
            <div
              key={report.id}
              className="group flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft transition-all hover:border-brand/30 sm:flex-row sm:items-center"
            >
              {/* Type icon */}
              <div className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
                report.report_type.includes("carbon") || report.report_type.includes("14064") || report.report_type.includes("cbam")
                  ? "bg-success/10 text-success"
                  : report.report_type.includes("water") || report.report_type.includes("14046")
                  ? "bg-info/10 text-info"
                  : "bg-brand-muted text-brand",
              )}>
                <TypeIcon className="h-5 w-5" />
              </div>

              {/* Main content */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold tracking-tight">{report.title}</h3>
                  <Badge variant="outline" className={cn("text-[10px]", statusCfg.className)}>
                    <StatusIcon className="mr-1 h-3 w-3" />
                    {statusCfg.label}
                  </Badge>
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>{report.reporting_period_start} → {report.reporting_period_end}</span>
                  <span>·</span>
                  <span className={typeCfg.accent}>{typeCfg.label}</span>
                  {report.submission_ref && (
                    <>
                      <span>·</span>
                      <span className="font-mono">{report.submission_ref}</span>
                    </>
                  )}
                </div>

                {/* Standards cited */}
                <div className="mt-2 flex flex-wrap gap-1">
                  {standards.map((s) => (
                    <Badge key={s} variant="outline" className="text-[9px] text-muted-foreground">
                      {s.replace(/-/g, " ").toUpperCase()}
                    </Badge>
                  ))}
                </div>

                {/* Audit hash */}
                <div className="mt-2 flex items-center gap-2">
                  <ShieldCheck className="h-3 w-3 text-success" />
                  <button
                    onClick={() => copyHash(report.sha256_hash)}
                    className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    title="Copy full SHA-256 hash"
                  >
                    {isCopied ? "Copied!" : shortHash}
                    <Copy className="h-2.5 w-2.5" />
                  </button>
                  <span className="text-[10px] text-muted-foreground">
                    Generated {new Date(report.generated_at).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadReport(report)}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  JSON
                </Button>
                {report.status === "draft" && (
                  <Button
                    size="sm"
                    className="gradient-brand text-primary-foreground border-0 hover:opacity-90"
                  >
                    <Send className="mr-1.5 h-3.5 w-3.5" />
                    Submit
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        {reports.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-border py-16 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/40" />
            <p className="font-medium text-muted-foreground">No reports yet</p>
            <p className="text-sm text-muted-foreground">
              Upload carbon or water data to generate your first ISO-compliant report.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
