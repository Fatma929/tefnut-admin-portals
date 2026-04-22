import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Database, Plug, Plus, Upload, XCircle } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Integrations"
        title="Data sources"
        description="Connect your ERP, IoT and operational systems to feed Tefnut with real data."
        actions={
          <>
            <Button variant="outline" size="sm">
              <Upload className="mr-2 h-4 w-4" /> Upload file
            </Button>
            <Button size="sm" className="gradient-brand text-primary-foreground border-0 hover:opacity-90">
              <Plus className="mr-2 h-4 w-4" /> Add source
            </Button>
          </>
        }
      />

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
              <Button size="sm" variant="ghost">
                <Plug className="mr-2 h-3.5 w-3.5" /> Manage
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
