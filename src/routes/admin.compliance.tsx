import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Clock, FileCheck2, Filter } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/admin/compliance")({
  head: () => ({ meta: [{ title: "Compliance — Tefnut Admin" }] }),
  component: CompliancePage,
});

const filings = [
  { client: "NileCement Group", report: "Q3 2026 CBAM", due: "30 Oct 2026", state: "review", risk: "low" },
  { client: "Suez Steel Holdings", report: "Q3 2026 CBAM", due: "30 Oct 2026", state: "draft", risk: "medium" },
  { client: "Atlas Industries", report: "Q3 2026 CBAM", due: "30 Oct 2026", state: "draft", risk: "high" },
  { client: "Levant Manufacturing", report: "Q3 2026 CBAM", due: "30 Oct 2026", state: "submitted", risk: "low" },
  { client: "Gulf Aluminum Co.", report: "Annual ESG 2025", due: "15 Nov 2026", state: "review", risk: "medium" },
  { client: "Kairos Fertilizers", report: "Q3 2026 CBAM", due: "30 Oct 2026", state: "draft", risk: "low" },
];

const stateMap = {
  draft: { label: "Draft", icon: Clock, className: "bg-warning/10 text-warning-foreground border-warning/30" },
  review: { label: "Review", icon: Clock, className: "bg-info/10 text-info border-info/30" },
  submitted: { label: "Submitted", icon: CheckCircle2, className: "bg-success/10 text-success border-success/30" },
};

const riskMap = {
  low: "bg-success/10 text-success",
  medium: "bg-warning/10 text-warning-foreground",
  high: "bg-destructive/10 text-destructive",
};

function CompliancePage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Oversight"
        title="Compliance pipeline"
        description="Track every CBAM and ESG filing across all customers in one place."
        actions={
          <Button variant="outline" size="sm"><Filter className="mr-2 h-4 w-4" /> Filter</Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: "Active filings", v: "32", tone: "text-foreground" },
          { label: "On track", v: "26", tone: "text-success" },
          { label: "At risk", v: "4", tone: "text-warning-foreground" },
          { label: "Overdue", v: "2", tone: "text-destructive" },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</p>
            <p className={`mt-2 text-2xl font-semibold ${s.tone}`}>{s.v}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-3">
        {filings.map((f, i) => {
          const meta = stateMap[f.state as keyof typeof stateMap];
          const Icon = meta.icon;
          return (
            <div key={i} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-soft sm:flex-row sm:items-center">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-muted text-brand">
                <FileCheck2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold tracking-tight">{f.client}</h3>
                  <span className="text-xs text-muted-foreground">· {f.report}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Due {f.due}</p>
              </div>
              <Badge variant="outline" className={meta.className}>
                <Icon className="mr-1 h-3 w-3" /> {meta.label}
              </Badge>
              <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${riskMap[f.risk as keyof typeof riskMap]}`}>
                {f.risk === "high" && <AlertTriangle className="h-3 w-3" />} {f.risk} risk
              </span>
              <Button variant="outline" size="sm">Open</Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
