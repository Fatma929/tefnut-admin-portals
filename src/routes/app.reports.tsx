import { createFileRoute } from "@tanstack/react-router";
import {
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Loader2,
  Plus,
  Send,
} from "lucide-react";
import { useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/app/reports")({
  head: () => ({ meta: [{ title: "CBAM Reports — Tefnut" }] }),
  component: ReportsPage,
});

const initialReports = [
  { id: "CBAM-2026-Q3", title: "Q3 2026 — CBAM Quarterly Report", status: "draft", progress: 92, due: "30 Oct 2026", products: 14 },
  { id: "CBAM-2026-Q2", title: "Q2 2026 — CBAM Quarterly Report", status: "submitted", progress: 100, due: "31 Jul 2026", products: 12 },
  { id: "CBAM-2026-Q1", title: "Q1 2026 — CBAM Quarterly Report", status: "submitted", progress: 100, due: "30 Apr 2026", products: 12 },
  { id: "ESG-2025", title: "Annual ESG Disclosure 2025", status: "review", progress: 78, due: "15 Nov 2026", products: 22 },
  { id: "CBAM-2025-Q4", title: "Q4 2025 — CBAM Quarterly Report", status: "submitted", progress: 100, due: "31 Jan 2026", products: 11 },
];

const statusMeta = {
  draft: { label: "Draft", className: "bg-warning/10 text-warning-foreground border-warning/30", icon: Clock },
  review: { label: "In review", className: "bg-info/10 text-info border-info/30", icon: Clock },
  submitted: { label: "Submitted", className: "bg-success/10 text-success border-success/30", icon: CheckCircle2 },
};

function ReportsPage() {
  const [reports, setReports] = useState(initialReports);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "info" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(message: string, type: "success" | "info" = "success") {
    setToast({ message, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  function handleNewReport() {
    const newId = `CBAM-2026-Q4`;
    setReports((prev) => [
      {
        id: newId,
        title: "Q4 2026 — CBAM Quarterly Report",
        status: "draft",
        progress: 0,
        due: "31 Jan 2027",
        products: 0,
      },
      ...prev,
    ]);
    showToast("New CBAM report created. Add your data to get started.", "info");
  }

  function handleSubmit(id: string) {
    setSubmitting(id);
    setTimeout(() => {
      setReports((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: "submitted", progress: 100 } : r)),
      );
      setSubmitting(null);
      showToast(`CBAM Report generated successfully based on verified data.`);
    }, 1800);
  }

  function handleDownload(report: typeof initialReports[0]) {
    setDownloading(report.id);
    setTimeout(() => {
      const blob = new Blob(
        [JSON.stringify({ report_id: report.id, title: report.title, status: report.status, generated_at: new Date().toISOString() }, null, 2)],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${report.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setDownloading(null);
      showToast(`${report.id} downloaded.`, "info");
    }, 600);
  }

  return (
    <div className="mx-auto max-w-7xl">
      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border px-4 py-3 shadow-elevated ${
          toast.type === "success"
            ? "border-success/30 bg-card text-foreground"
            : "border-info/30 bg-card text-foreground"
        }`}>
          <CheckCircle2 className={`h-4 w-4 ${toast.type === "success" ? "text-success" : "text-info"}`} />
          <span className="text-sm font-medium">{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 text-xs text-muted-foreground hover:text-foreground">✕</button>
        </div>
      )}

      <PageHeader
        eyebrow="Compliance"
        title="CBAM Reports"
        description="Generate, review and submit CBAM-ready reports for EU customs authorities."
        actions={
          <Button
            size="sm"
            className="gradient-brand text-primary-foreground border-0 hover:opacity-90"
            onClick={handleNewReport}
          >
            <Plus className="mr-2 h-4 w-4" /> New report
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Submitted YTD", value: String(reports.filter((r) => r.status === "submitted").length), hint: "On time" },
          { label: "In progress", value: String(reports.filter((r) => r.status !== "submitted").length), hint: "Active drafts" },
          { label: "Avg completeness", value: `${Math.round(reports.reduce((s, r) => s + r.progress, 0) / reports.length)}%`, hint: "Across active reports" },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</p>
            <p className="mt-2 text-2xl font-semibold">{s.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        {reports.map((r) => {
          const meta = statusMeta[r.status as keyof typeof statusMeta];
          const Icon = meta.icon;
          const isSubmitting = submitting === r.id;
          const isDownloading = downloading === r.id;

          return (
            <div
              key={r.id}
              className="group flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft transition-all hover:border-brand/40 sm:flex-row sm:items-center"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-muted text-brand">
                <FileText className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold tracking-tight">{r.title}</h3>
                  <Badge variant="outline" className={meta.className}>
                    <Icon className="mr-1 h-3 w-3" />
                    {meta.label}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.id} · {r.products} CBAM goods · Due {r.due}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
                    <div className="h-full gradient-brand rounded-full transition-all" style={{ width: `${r.progress}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">{r.progress}%</span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isDownloading}
                  onClick={() => handleDownload(r)}
                >
                  {isDownloading
                    ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    : <Download className="mr-2 h-3.5 w-3.5" />}
                  {isDownloading ? "…" : "PDF"}
                </Button>
                {r.status !== "submitted" && (
                  <Button
                    size="sm"
                    className="gradient-brand text-primary-foreground border-0 hover:opacity-90"
                    disabled={isSubmitting}
                    onClick={() => handleSubmit(r.id)}
                  >
                    {isSubmitting
                      ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      : <Send className="mr-2 h-3.5 w-3.5" />}
                    {isSubmitting ? "Generating…" : "Submit"}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
