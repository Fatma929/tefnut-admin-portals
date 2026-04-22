import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  Building2,
  Database,
  Download,
  Droplets,
  FileText,
  Leaf,
  Plus,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/app/")({
  component: DashboardPage,
});

const emissionsData = [
  { month: "Jan", scope1: 12400, scope2: 4200, scope3: 2100 },
  { month: "Feb", scope1: 11800, scope2: 4100, scope3: 1980 },
  { month: "Mar", scope1: 12100, scope2: 4300, scope3: 2050 },
  { month: "Apr", scope1: 11200, scope2: 3950, scope3: 1900 },
  { month: "May", scope1: 10900, scope2: 3800, scope3: 1840 },
  { month: "Jun", scope1: 10400, scope2: 3700, scope3: 1780 },
  { month: "Jul", scope1: 10100, scope2: 3650, scope3: 1720 },
  { month: "Aug", scope1: 9800, scope2: 3600, scope3: 1700 },
  { month: "Sep", scope1: 9500, scope2: 3550, scope3: 1660 },
];

const sourceMix = [
  { name: "Process emissions", value: 48, color: "var(--chart-1)" },
  { name: "Fuel combustion", value: 22, color: "var(--chart-2)" },
  { name: "Electricity", value: 18, color: "var(--chart-3)" },
  { name: "Logistics", value: 8, color: "var(--chart-4)" },
  { name: "Other", value: 4, color: "var(--chart-5)" },
];

function DashboardPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Overview · NileCement Group"
        title="Sustainability dashboard"
        description="Real-time view of emissions, water and CBAM readiness across your operations."
        actions={
          <>
            <Button variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" /> Export
            </Button>
            <Button asChild size="sm" className="gradient-brand text-primary-foreground border-0 hover:opacity-90">
              <Link to="/app/reports">
                New CBAM report <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </>
        }
      />

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total CO₂e (YTD)"
          value="142,860 t"
          change={{ value: "8.2%", direction: "down", positiveIs: "down" }}
          icon={Leaf}
          hint="vs. last year"
        />
        <StatCard
          label="Energy intensity"
          value="3.42 GJ/t"
          change={{ value: "2.1%", direction: "down", positiveIs: "down" }}
          icon={Zap}
          hint="per ton clinker"
        />
        <StatCard
          label="Water withdrawal"
          value="1.2M m³"
          change={{ value: "1.4%", direction: "up", positiveIs: "down" }}
          icon={Droplets}
          hint="vs. last year"
        />
        <StatCard
          label="CBAM completeness"
          value="92%"
          change={{ value: "12%", direction: "up", positiveIs: "up" }}
          icon={FileText}
          hint="ready for Q3 filing"
        />
      </div>

      {/* Charts row */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft lg:col-span-2">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold tracking-tight">Emissions trend</h3>
              <p className="text-sm text-muted-foreground">Monthly tCO₂e by scope</p>
            </div>
            <div className="flex gap-2 text-xs">
              {[
                { l: "Scope 1", c: "var(--chart-1)" },
                { l: "Scope 2", c: "var(--chart-2)" },
                { l: "Scope 3", c: "var(--chart-3)" },
              ].map((s) => (
                <div key={s.l} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.c }} />
                  <span className="text-muted-foreground">{s.l}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-6 h-64 w-full">
            <ResponsiveContainer>
              <AreaChart data={emissionsData} margin={{ top: 10, right: 5, left: -15, bottom: 0 }}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="g3" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                />
                <Area type="monotone" dataKey="scope1" stroke="var(--chart-1)" strokeWidth={2} fill="url(#g1)" />
                <Area type="monotone" dataKey="scope2" stroke="var(--chart-2)" strokeWidth={2} fill="url(#g2)" />
                <Area type="monotone" dataKey="scope3" stroke="var(--chart-3)" strokeWidth={2} fill="url(#g3)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          <h3 className="font-semibold tracking-tight">Source mix</h3>
          <p className="text-sm text-muted-foreground">Share of total emissions</p>
          <div className="mt-4 h-44">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={sourceMix}
                  innerRadius={45}
                  outerRadius={75}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {sourceMix.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} stroke="var(--card)" strokeWidth={2} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 space-y-2">
            {sourceMix.map((s) => (
              <div key={s.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  <span className="text-muted-foreground">{s.name}</span>
                </div>
                <span className="font-medium tabular-nums">{s.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Activity + actions */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold tracking-tight">Recent activity</h3>
              <p className="text-sm text-muted-foreground">Data ingestion and report events</p>
            </div>
            <Button variant="ghost" size="sm">View all</Button>
          </div>
          <div className="mt-4 divide-y divide-border">
            {[
              { icon: FileText, title: "Q3 2026 CBAM report draft generated", time: "2h ago", tag: "Report", tone: "bg-info/10 text-info" },
              { icon: Database, title: "ERP sync completed — 4,210 records", time: "5h ago", tag: "Sync", tone: "bg-brand-muted text-brand" },
              { icon: Leaf, title: "Kiln 02 emission factor updated", time: "Yesterday", tag: "Config", tone: "bg-accent text-accent-foreground" },
              { icon: Activity, title: "Anomaly detected on Grinding Mill electricity", time: "Yesterday", tag: "Alert", tone: "bg-warning/10 text-warning-foreground" },
              { icon: FileText, title: "Q2 CBAM filing submitted to EU portal", time: "3 days ago", tag: "Submitted", tone: "bg-success/10 text-success" },
            ].map((row, i) => (
              <div key={i} className="flex items-center gap-4 py-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${row.tone}`}>
                  <row.icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{row.title}</p>
                  <p className="text-xs text-muted-foreground">{row.time}</p>
                </div>
                <Badge variant="outline" className="text-[10px]">{row.tag}</Badge>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border gradient-card p-6 shadow-soft">
          <h3 className="font-semibold tracking-tight">Quick actions</h3>
          <p className="text-sm text-muted-foreground">Get things done in a click</p>
          <div className="mt-4 space-y-2">
            {[
              { icon: Plus, label: "Add new data source", to: "/app/data" },
              { icon: FileText, label: "Generate CBAM report", to: "/app/reports" },
              { icon: Building2, label: "Register new site", to: "/app/sites" },
              { icon: Download, label: "Export emissions ledger", to: "/app/emissions" },
            ].map((a) => (
              <Link
                key={a.label}
                to={a.to}
                className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5 text-sm font-medium transition-all hover:border-brand hover:shadow-soft"
              >
                <span className="flex items-center gap-2.5">
                  <a.icon className="h-4 w-4 text-brand" />
                  {a.label}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


