import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Clock, Download, FileText, Plus, Send } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/app/reports")({
  head: () => ({ meta: [{ title: "CBAM Reports — Tefnut" }] }),
  component: ReportsPage,
});

const reports = [
  { id: "CBAM-2026-Q3", title: "Q3 2026 — CBAM Quarterly Report", status: "draft", progress: 92, due: "30 Oct 2026", products: 14 },
  { id: "CBAM-2026-Q2", title: "Q2 2026 — CBAM Quarterly Report", status: "submitted", progress: 100, due: "31 Jul 2026", products: 12 },
  { id: "CBAM-2026-Q1", title: "Q1 2026 — CBAM Quarterly Report", status: "submitted", progress: 100, due: "30 Apr 2026", products: 12 },
  { id: "ESG-2025", title: "Annual ESG Disclosure 2025", status: "review", progress: 78, due: "15 Nov 2026", products: 22 },
  { id: "CBAM-2025-Q4", title: "Q4 2025 — CBAM Quarterly Report", status: "submitted", progress: 100, due: "31 Jan 2026", products: 11 },
];

const statusMap = {
  draft: { label: "Draft", className: "bg-warning/10 text-warning-foreground border-warning/30", icon: Clock },
  review: { label: "In review", className: "bg-info/10 text-info border-info/30", icon: Clock },
  submitted: { label: "Submitted", className: "bg-success/10 text-success border-success/30", icon: CheckCircle2 },
};

function ReportsPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Compliance"
        title="CBAM Reports"
        description="Generate, review and submit CBAM-ready reports for EU customs authorities."
        actions={
          <Button size="sm" className="gradient-brand text-primary-foreground border-0 hover:opacity-90">
            <Plus className="mr-2 h-4 w-4" /> New report
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Submitted YTD", value: "3", hint: "On time" },
          { label: "In progress", value: "2", hint: "Q3 2026 + ESG" },
          { label: "Avg completeness", value: "94%", hint: "Across active reports" },
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
          const meta = statusMap[r.status as keyof typeof statusMap];
          const Icon = meta.icon;
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
                    <div className="h-full gradient-brand rounded-full" style={{ width: `${r.progress}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">{r.progress}%</span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm">
                  <Download className="mr-2 h-3.5 w-3.5" /> PDF
                </Button>
                {r.status !== "submitted" && (
                  <Button size="sm" className="gradient-brand text-primary-foreground border-0 hover:opacity-90">
                    <Send className="mr-2 h-3.5 w-3.5" /> Submit
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
