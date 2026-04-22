import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  FileCheck2,
  Leaf,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/admin/")({
  component: AdminOverview,
});

const adoption = [
  { m: "Apr", v: 28 }, { m: "May", v: 31 }, { m: "Jun", v: 33 },
  { m: "Jul", v: 38 }, { m: "Aug", v: 41 }, { m: "Sep", v: 47 },
];

const reportsByQuarter = [
  { q: "Q1 25", v: 38 }, { q: "Q2 25", v: 51 }, { q: "Q3 25", v: 64 },
  { q: "Q4 25", v: 79 }, { q: "Q1 26", v: 102 }, { q: "Q2 26", v: 124 },
];

function AdminOverview() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Tefnut Admin"
        title="Platform overview"
        description="Tenant health, compliance throughput and platform telemetry across all customers."
        actions={
          <>
            <Button variant="outline" size="sm">Export report</Button>
            <Button size="sm" className="gradient-brand text-primary-foreground border-0 hover:opacity-90">
              Onboard client <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active clients" value="47" change={{ value: "12%", direction: "up", positiveIs: "up" }} icon={Users} hint="this quarter" />
        <StatCard label="CBAM reports filed" value="124" change={{ value: "21%", direction: "up", positiveIs: "up" }} icon={FileCheck2} hint="Q2 2026" />
        <StatCard label="tCO₂e under management" value="4.8M" change={{ value: "9%", direction: "up", positiveIs: "up" }} icon={Leaf} hint="across all sites" />
        <StatCard label="Platform uptime" value="99.98%" change={{ value: "0.02%", direction: "up", positiveIs: "up" }} icon={Activity} hint="trailing 30d" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft lg:col-span-2">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold tracking-tight">Client adoption</h3>
              <p className="text-sm text-muted-foreground">Active industrial customers per month</p>
            </div>
            <Badge className="bg-success/10 text-success border-0">+19 QoQ</Badge>
          </div>
          <div className="mt-6 h-64">
            <ResponsiveContainer>
              <AreaChart data={adoption} margin={{ top: 10, right: 5, left: -15, bottom: 0 }}>
                <defs>
                  <linearGradient id="adopt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="m" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
                <Area type="monotone" dataKey="v" stroke="var(--chart-2)" strokeWidth={2} fill="url(#adopt)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          <h3 className="font-semibold tracking-tight">CBAM throughput</h3>
          <p className="text-sm text-muted-foreground">Reports filed per quarter</p>
          <div className="mt-6 h-64">
            <ResponsiveContainer>
              <BarChart data={reportsByQuarter} margin={{ top: 10, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="q" stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
                <Bar dataKey="v" fill="var(--chart-1)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold tracking-tight">Top clients by emissions managed</h3>
            <Button variant="ghost" size="sm">View all clients</Button>
          </div>
          <div className="mt-4 divide-y divide-border">
            {[
              { name: "NileCement Group", country: "Egypt", emissions: "142,860 tCO₂e", reports: 12, status: "healthy" },
              { name: "Suez Steel Holdings", country: "Egypt", emissions: "98,420 tCO₂e", reports: 9, status: "healthy" },
              { name: "Atlas Industries", country: "Morocco", emissions: "76,210 tCO₂e", reports: 7, status: "warning" },
              { name: "Levant Manufacturing", country: "Jordan", emissions: "54,910 tCO₂e", reports: 6, status: "healthy" },
              { name: "Gulf Aluminum Co.", country: "UAE", emissions: "41,380 tCO₂e", reports: 5, status: "healthy" },
            ].map((c) => (
              <div key={c.name} className="flex items-center gap-4 py-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-muted text-brand">
                  <Building2 className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.country} · {c.reports} reports</p>
                </div>
                <span className="hidden text-sm tabular-nums text-muted-foreground sm:inline">{c.emissions}</span>
                {c.status === "healthy" ? (
                  <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Healthy
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-warning/10 text-warning-foreground border-warning/30">
                    <AlertTriangle className="mr-1 h-3 w-3" /> Attention
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border gradient-card p-6 shadow-soft">
          <h3 className="font-semibold tracking-tight">System signals</h3>
          <p className="text-sm text-muted-foreground">Real-time platform health</p>
          <div className="mt-4 space-y-3">
            {[
              { label: "API latency (p95)", v: "142 ms", tone: "text-success" },
              { label: "Ingestion queue", v: "Healthy", tone: "text-success" },
              { label: "ERP connector errors (24h)", v: "3", tone: "text-warning-foreground" },
              { label: "Pending tenant approvals", v: "2", tone: "text-info" },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between rounded-lg border border-border bg-background p-3 text-sm">
                <span className="text-muted-foreground">{row.label}</span>
                <span className={`font-semibold ${row.tone}`}>{row.v}</span>
              </div>
            ))}
            <div className="mt-4 rounded-lg border border-brand/30 bg-brand-muted p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-brand">
                <TrendingUp className="h-4 w-4" /> Quarterly review ready
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Q3 platform metrics are compiled. Schedule the leadership readout.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
