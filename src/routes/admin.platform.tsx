import { createFileRoute } from "@tanstack/react-router";
import { Activity, Cpu, Database, Globe, HardDrive, Zap } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/admin/platform")({
  head: () => ({ meta: [{ title: "Platform — Tefnut Admin" }] }),
  component: PlatformPage,
});

const latency = Array.from({ length: 24 }, (_, i) => ({
  h: `${i}:00`,
  v: 110 + Math.round(Math.sin(i / 3) * 25 + Math.random() * 15),
}));

function PlatformPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Operations"
        title="Platform health"
        description="Infrastructure metrics, ingestion pipelines and service availability."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: Activity, label: "Uptime (30d)", v: "99.98%", tone: "text-success" },
          { icon: Zap, label: "API p95", v: "142 ms", tone: "text-foreground" },
          { icon: Database, label: "Ingestion lag", v: "1.4 s", tone: "text-foreground" },
          { icon: HardDrive, label: "Storage", v: "62% / 5 TB", tone: "text-foreground" },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <s.icon className="h-4 w-4 text-brand" />
            </div>
            <p className={`mt-2 text-2xl font-semibold ${s.tone}`}>{s.v}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft lg:col-span-2">
          <h3 className="font-semibold tracking-tight">API latency · last 24h</h3>
          <p className="text-sm text-muted-foreground">p95 response time across regions (ms)</p>
          <div className="mt-6 h-64">
            <ResponsiveContainer>
              <LineChart data={latency} margin={{ top: 10, right: 5, left: -15, bottom: 0 }}>
                <XAxis dataKey="h" stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} interval={3} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
                <Line type="monotone" dataKey="v" stroke="var(--chart-2)" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-border gradient-card p-6 shadow-soft">
          <h3 className="font-semibold tracking-tight">Services</h3>
          <p className="text-sm text-muted-foreground">Component status</p>
          <div className="mt-4 space-y-2">
            {[
              { name: "Web App", status: "Operational", icon: Globe },
              { name: "API Gateway", status: "Operational", icon: Activity },
              { name: "Ingestion Workers", status: "Operational", icon: Cpu },
              { name: "Reports Engine", status: "Operational", icon: Database },
              { name: "ERP Connectors", status: "Degraded", icon: Database },
              { name: "Object Storage", status: "Operational", icon: HardDrive },
            ].map((s) => (
              <div key={s.name} className="flex items-center justify-between rounded-lg border border-border bg-background p-3 text-sm">
                <span className="flex items-center gap-2">
                  <s.icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">{s.name}</span>
                </span>
                <Badge
                  variant="outline"
                  className={
                    s.status === "Operational"
                      ? "bg-success/10 text-success border-success/30"
                      : "bg-warning/10 text-warning-foreground border-warning/30"
                  }
                >
                  {s.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
