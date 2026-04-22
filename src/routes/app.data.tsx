import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Database,
  FileText,
  Loader2,
  Plug,
  Plus,
  ShieldCheck,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IsoReportPreview } from "@/components/IsoReportPreview";
import { IsoWaterReportPreview } from "@/components/IsoWaterReportPreview";
import { useEngineUpload } from "@/hooks/use-engine-upload";
import { buildIsoReport } from "@/lib/iso-report";
import { buildIsoWaterReport } from "@/lib/iso-water-report";
import type { CarbonResult, WaterResult } from "@/lib/engine-types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/data")({
  head: () => ({ meta: [{ title: "Data Sources — Tefnut" }] }),
  component: DataPage,
});

const sources = [
  { name: "SAP S/4HANA — Production", type: "ERP", status: "connected", last: "12 min ago", records: "1.2M" },
  { name: "Schneider EcoStruxure — Energy", type: "IoT / Sensors", status: "connected", last: "2 min ago", records: "8.4M" },
  { name: "Oracle EBS — Procurement", type: "ERP", status: "connected", last: "1h ago", records: "320K" },
  { name: "Manual fuel logs (Suez)", type: "Spreadsheet", status: "connected", last: "Yesterday", records: "12K" },
  { name: "DHL Logistics API", type: "API", status: "error", last: "Auth failed · 3h ago", records: "—" },
  { name: "Cement quality lab files", type: "Upload", status: "pending", last: "Awaiting upload", records: "—" },
];

const statusMap = {
  connected: { label: "Connected", className: "bg-success/10 text-success border-success/30", icon: CheckCircle2 },
  error: { label: "Error", className: "bg-destructive/10 text-destructive border-destructive/30", icon: XCircle },
  pending: { label: "Pending", className: "bg-warning/10 text-warning-foreground border-warning/30", icon: Upload },
};

function DataPage() {
  const carbon = useEngineUpload("carbon");
  const water = useEngineUpload("water");

  const isUploading = carbon.status === "uploading" || carbon.status === "hashing"
    || water.status === "uploading" || water.status === "hashing";

  return (
    <div className="mx-auto max-w-7xl">
      {/* Hidden file inputs — one per engine */}
      <input
        ref={carbon.inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={carbon.handleFileChange}
      />
      <input
        ref={water.inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={water.handleFileChange}
      />

      <PageHeader
        eyebrow="Integrations"
        title="Data sources"
        description="Connect your ERP, IoT and operational systems to feed Tefnut with real data."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={isUploading}
              onClick={carbon.trigger}
            >
              {carbon.status === "hashing" || carbon.status === "uploading" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              {carbon.status === "hashing" ? "Hashing…"
                : carbon.status === "uploading" ? "Calculating…"
                : "Upload Carbon Excel"}
            </Button>
            <Button
              size="sm"
              className="gradient-brand text-primary-foreground border-0 hover:opacity-90"
              disabled={isUploading}
              onClick={water.trigger}
            >
              {water.status === "hashing" || water.status === "uploading" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              {water.status === "hashing" ? "Hashing…"
                : water.status === "uploading" ? "Calculating…"
                : "Upload Water Excel"}
            </Button>
          </>
        }
      />

      {/* ── Carbon upload feedback ── */}
      <UploadFeedback engine="Carbon" upload={carbon} onDismiss={carbon.reset} />

      {/* ── Water upload feedback ── */}
      <UploadFeedback engine="Water" upload={water} onDismiss={water.reset} />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Active sources", value: "5" },
          { label: "Records this month", value: "12.4M" },
          { label: "Sync health", value: "82%" },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</p>
            <p className="mt-2 text-2xl font-semibold">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-3">
        {sources.map((s) => {
          const meta = statusMap[s.status as keyof typeof statusMap];
          const Icon = meta.icon;
          return (
            <div key={s.name} className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-muted text-brand">
                <Database className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold tracking-tight">{s.name}</p>
                  <Badge variant="outline" className="text-[10px]">{s.type}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Last sync: {s.last} · {s.records} records
                </p>
              </div>
              <Badge variant="outline" className={meta.className}>
                <Icon className="mr-1 h-3 w-3" /> {meta.label}
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                onClick={s.type === "Upload" ? carbon.trigger : undefined}
              >
                <Plug className="mr-2 h-3.5 w-3.5" />
                {s.type === "Upload" ? "Upload" : "Manage"}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UploadFeedback — inline alert panel shown below the header
// ---------------------------------------------------------------------------
interface UploadFeedbackProps {
  engine: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  upload: ReturnType<typeof useEngineUpload<any>>;
  onDismiss: () => void;
}

function UploadFeedback({ engine, upload, onDismiss }: UploadFeedbackProps) {
  const { status, errors, warnings, result, fileName, fileHash } = upload;

  if (status === "idle") return null;

  // ── Hashing / uploading spinner ──
  if (status === "hashing" || status === "uploading") {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
        <Loader2 className="h-4 w-4 animate-spin text-brand" />
        <p className="text-sm text-muted-foreground">
          {status === "hashing"
            ? `Computing SHA-256 hash for ${fileName}…`
            : `Sending ${fileName} to ${engine} engine…`}
        </p>
      </div>
    );
  }

  // ── Error state ──
  if (status === "error" && errors.length > 0) {
    return (
      <div className="mb-4 space-y-2">
        {errors.map((err, i) => (
          <div
            key={i}
            className={cn(
              "flex items-start gap-3 rounded-xl border px-4 py-3",
              err.error_code === "DUPLICATE_SUBMISSION"
                ? "border-warning/40 bg-warning/8"
                : "border-destructive/30 bg-destructive/8",
            )}
          >
            <AlertTriangle className={cn(
              "mt-0.5 h-4 w-4 shrink-0",
              err.error_code === "DUPLICATE_SUBMISSION" ? "text-warning-foreground" : "text-destructive",
            )} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-foreground">{err.error_code}</p>
                <Badge variant="outline" className="text-[10px]">{err.field}</Badge>
              </div>
              <p className="mt-0.5 text-sm text-foreground">{err.message}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="font-medium">Suggested fix:</span> {err.suggested_fix}
              </p>
            </div>
            <button onClick={onDismiss} className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {/* Non-blocking warnings alongside errors */}
        {warnings.map((w, i) => (
          <WarningRow key={i} warning={w} />
        ))}
      </div>
    );
  }

  // ── Success state ──
  if (status === "success" && result) {
    const auditHash = (result as { audit_trail?: { source_reference?: { input_hash?: string } } })
      ?.audit_trail?.source_reference?.input_hash ?? fileHash ?? "";
    const methodology = (result as { methodology?: { protocol_name?: string; protocol_version?: string } })
      ?.methodology;
    const shortHash = auditHash.slice(0, 8) + "…" + auditHash.slice(-4);

    // Build ISO report if this is a carbon result
    const isCarbonResult = engine === "Carbon" && methodology?.protocol_name?.includes("Carbon");
    const isWaterResult = engine === "Water" && methodology?.protocol_name?.includes("Water");
    const isoReport = isCarbonResult ? buildIsoReport(result as CarbonResult) : null;
    const isoWaterReport = isWaterResult ? buildIsoWaterReport(result as WaterResult) : null;

    return (
      <div className="mb-4 space-y-2">
        <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/8 px-4 py-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-foreground">
                {engine} engine — calculation complete
              </p>
              {methodology && (
                <Badge variant="outline" className="text-[10px] bg-brand-muted text-brand border-brand/20">
                  {methodology.protocol_name} v{methodology.protocol_version}
                </Badge>
              )}
              {isoReport && (
                <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/30">
                  ISO 14064-1:2018 ready
                </Badge>
              )}
              {isoWaterReport && (
                <Badge variant="outline" className="text-[10px] bg-info/10 text-info border-info/30">
                  ISO 14046:2014 ready
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              File: <span className="font-medium">{fileName}</span>
            </p>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              Audit ID: {shortHash}
            </p>
          </div>
          <button onClick={onDismiss} className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Non-blocking warnings */}
        {warnings.map((w, i) => (
          <WarningRow key={i} warning={w} />
        ))}

        {/* ISO 14064-1 Report Preview — carbon uploads only */}
        {isoReport && <IsoReportExpandable report={isoReport} />}

        {/* ISO 14046 Water Report Preview — water uploads only */}
        {isoWaterReport && <IsoWaterReportExpandable report={isoWaterReport} />}
      </div>
    );
  }

  return null;
}

function WarningRow({ warning }: { warning: { error_code: string; field: string; message: string; suggested_fix: string; meta: Record<string, unknown> } }) {
  const isUnitMismatch = warning.error_code === "UNIT_MISMATCH_SUSPECTED";
  const meta = warning.meta as { suspected_scale?: number; suggested_corrected_value?: number; submitted_value?: number };

  return (
    <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/8 px-4 py-3">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-foreground">{warning.error_code}</p>
          <Badge variant="outline" className="text-[10px]">{warning.field}</Badge>
        </div>
        <p className="mt-0.5 text-sm text-foreground">{warning.message}</p>
        {isUnitMismatch && meta.suggested_corrected_value != null && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Did you mean{" "}
            <strong>{meta.suggested_corrected_value.toLocaleString()}</strong>{" "}
            instead of <strong>{meta.submitted_value?.toLocaleString()}</strong>?
            {meta.suspected_scale && ` (÷ ${meta.suspected_scale.toLocaleString()})`}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="font-medium">Suggested fix:</span> {warning.suggested_fix}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// IsoReportExpandable — collapsible ISO 14064-1 report panel
// ---------------------------------------------------------------------------
function IsoReportExpandable({ report }: { report: ReturnType<typeof buildIsoReport> }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-brand/20 bg-brand-muted/30 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-brand-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-brand" />
          <span className="text-sm font-semibold text-brand">ISO 14064-1:2018 Report Preview</span>
          <Badge variant="outline" className="text-[10px] bg-brand-muted text-brand border-brand/20">
            Clause 9.3
          </Badge>
        </div>
        <ChevronDown className={cn(
          "h-4 w-4 text-brand transition-transform",
          open && "rotate-180",
        )} />
      </button>
      {open && (
        <div className="border-t border-brand/20 p-4">
          <IsoReportPreview report={report} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// IsoWaterReportExpandable — collapsible ISO 14046 water report panel
// ---------------------------------------------------------------------------
function IsoWaterReportExpandable({ report }: { report: ReturnType<typeof buildIsoWaterReport> }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-info/20 bg-info/5 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-info/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-info" />
          <span className="text-sm font-semibold text-info">ISO 14046:2014 Water Footprint Report</span>
          <Badge variant="outline" className="text-[10px] bg-info/10 text-info border-info/20">
            §6.4 Flow Categories
          </Badge>
        </div>
        <ChevronDown className={cn(
          "h-4 w-4 text-info transition-transform",
          open && "rotate-180",
        )} />
      </button>
      {open && (
        <div className="border-t border-info/20 p-4">
          <IsoWaterReportPreview report={report} />
        </div>
      )}
    </div>
  );
}
