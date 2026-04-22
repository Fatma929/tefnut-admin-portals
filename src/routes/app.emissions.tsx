import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Filter } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/app/emissions")({
  head: () => ({ meta: [{ title: "Emissions — Tefnut" }] }),
  component: EmissionsPage,
});

const sites = [
  { site: "Cement Plant — Suez", scope1: 48210, scope2: 9100, scope3: 3200, intensity: "0.82" },
  { site: "Cement Plant — Helwan", scope1: 39540, scope2: 7800, scope3: 2900, intensity: "0.79" },
  { site: "Grinding Mill — Alexandria", scope1: 21900, scope2: 4500, scope3: 1800, intensity: "0.41" },
  { site: "Logistics Hub — Cairo", scope1: 6100, scope2: 1300, scope3: 4800, intensity: "0.12" },
  { site: "Quarry — Minya", scope1: 9210, scope2: 2400, scope3: 980, intensity: "0.38" },
];

const monthly = [
  { m: "Jan", v: 18700 }, { m: "Feb", v: 17880 }, { m: "Mar", v: 18450 },
  { m: "Apr", v: 17050 }, { m: "May", v: 16540 }, { m: "Jun", v: 15880 },
  { m: "Jul", v: 15470 }, { m: "Aug", v: 15100 }, { m: "Sep", v: 14710 },
];

function EmissionsPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Carbon ledger"
        title="Emissions"
        description="Scope 1, 2 and 3 emissions broken down by site and time period."
        actions={
          <>
            <Button variant="outline" size="sm"><Filter className="mr-2 h-4 w-4" /> Filter</Button>
            <Button size="sm" className="gradient-brand text-primary-foreground border-0 hover:opacity-90">
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold tracking-tight">Total monthly emissions</h3>
              <p className="text-sm text-muted-foreground">tCO₂e — all sites</p>
            </div>
            <Badge className="bg-success/10 text-success border-0">Trending down</Badge>
          </div>
          <div className="mt-6 h-72">
            <ResponsiveContainer>
              <BarChart data={monthly} margin={{ top: 10, right: 5, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="m" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
                <Bar dataKey="v" fill="var(--chart-1)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-border gradient-card p-6 shadow-soft">
          <h3 className="font-semibold tracking-tight">Targets & progress</h3>
          <p className="text-sm text-muted-foreground">Net-zero pathway 2030</p>
          <div className="mt-5 space-y-5">
            {[
              { label: "2026 reduction target", v: 18, t: "−15% vs 2024", color: "var(--chart-1)" },
              { label: "Renewable share", v: 42, t: "Target 60%", color: "var(--chart-2)" },
              { label: "Alt. fuels in kiln", v: 28, t: "Target 35%", color: "var(--chart-3)" },
            ].map((t) => (
              <div key={t.label}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{t.label}</span>
                  <span className="tabular-nums text-muted-foreground">{t.v}%</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: `${t.v}%`, background: t.color }} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t.t}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card shadow-soft">
        <div className="flex items-center justify-between border-b border-border p-6">
          <div>
            <h3 className="font-semibold tracking-tight">By site</h3>
            <p className="text-sm text-muted-foreground">Year-to-date breakdown (tCO₂e)</p>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Site</TableHead>
              <TableHead className="text-right">Scope 1</TableHead>
              <TableHead className="text-right">Scope 2</TableHead>
              <TableHead className="text-right">Scope 3</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Intensity (tCO₂e/t)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sites.map((s) => {
              const total = s.scope1 + s.scope2 + s.scope3;
              return (
                <TableRow key={s.site}>
                  <TableCell className="font-medium">{s.site}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.scope1.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.scope2.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.scope3.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{total.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.intensity}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
