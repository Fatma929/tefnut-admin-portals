import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  Database,
  Droplets,
  FileText,
  Globe2,
  Leaf,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { TefnutLogo } from "@/components/TefnutLogo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tefnut — Sustainability & CBAM Compliance Made Simple" },
      {
        name: "description",
        content:
          "Tefnut helps industrial companies measure, report and reduce carbon emissions while staying CBAM-compliant.",
      },
      { property: "og:title", content: "Tefnut — Sustainability & CBAM Compliance Made Simple" },
      {
        property: "og:description",
        content:
          "From raw operational data to compliant CBAM reports — seamlessly. Built for cement, manufacturing and EU exporters.",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <TefnutLogo />
          <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            <a href="#solution" className="hover:text-foreground">Solution</a>
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#how" className="hover:text-foreground">How it works</a>
            <a href="#market" className="hover:text-foreground">Industries</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin">Admin</Link>
            </Button>
            <Button asChild size="sm" className="gradient-brand text-primary-foreground border-0 shadow-soft hover:opacity-90">
              <Link to="/app">
                Open Portal <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden gradient-hero">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <Badge variant="secondary" className="mb-6 border border-border bg-card px-3 py-1 text-xs font-medium shadow-soft">
              <Sparkles className="mr-1.5 h-3 w-3 text-brand" />
              Built for CBAM. Engineered for industry.
            </Badge>
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              Sustainability & CBAM compliance,{" "}
              <span className="bg-gradient-to-r from-brand to-chart-2 bg-clip-text text-transparent">
                made simple.
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
              Tefnut measures your environmental impact, centralises operational data and turns
              raw inputs into CBAM-ready reports — so you can comply, decarbonise and grow.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="gradient-brand text-primary-foreground border-0 shadow-glow hover:opacity-90">
                <Link to="/app">
                  Launch Industry Portal <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/admin">Open Admin Console</Link>
              </Button>
            </div>
            <div className="mt-12 grid grid-cols-3 gap-4 border-t border-border/60 pt-8 text-left sm:gap-8">
              {[
                { k: "Scope 1·2·3", v: "Carbon tracking" },
                { k: "EU CBAM", v: "Report-ready" },
                { k: "MENA", v: "Heavy industry focus" },
              ].map((s) => (
                <div key={s.k}>
                  <p className="text-sm font-semibold text-foreground">{s.k}</p>
                  <p className="text-xs text-muted-foreground">{s.v}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Solution */}
      <section id="solution" className="border-t border-border bg-card/30">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-wider text-brand">The Solution</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">
              From raw data to compliant reports — seamlessly.
            </h2>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: BarChart3, title: "Measure", text: "Carbon and water footprints across operations." },
              { icon: FileText, title: "Generate", text: "CBAM-ready reports and ESG disclosures." },
              { icon: Database, title: "Centralize", text: "Unify environmental data from ERP & sensors." },
              { icon: Target, title: "Deliver", text: "Actionable insights to reduce emissions." },
            ].map((c) => (
              <div
                key={c.title}
                className="group rounded-2xl border border-border gradient-card p-6 shadow-soft transition-all hover:shadow-elevated hover:-translate-y-0.5"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-muted text-brand">
                  <c.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-lg font-semibold tracking-tight">{c.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{c.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-brand">What Tefnut Offers</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">
                Built specifically for industrial operations.
              </h2>
              <p className="mt-4 text-muted-foreground">
                Every feature is purpose-built for the realities of cement plants, manufacturing
                lines and cross-border exporters — not retrofitted from generic ESG software.
              </p>
              <ul className="mt-8 space-y-4">
                {[
                  { icon: Leaf, title: "Carbon Footprint Tracking", text: "Scope 1, 2 and 3 with industry-grade emission factors." },
                  { icon: Droplets, title: "Water Footprint Analysis", text: "Withdrawal, consumption and discharge across sites." },
                  { icon: ShieldCheck, title: "CBAM Reporting Tools", text: "Pre-formatted templates aligned with EU regulation." },
                  { icon: Database, title: "ERP Data Integration", text: "Connect SAP, Oracle, Odoo and operational sensors." },
                ].map((f) => (
                  <li key={f.title} className="flex gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-muted text-brand">
                      <f.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">{f.title}</p>
                      <p className="text-sm text-muted-foreground">{f.text}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative">
              <div className="rounded-3xl border border-border gradient-card p-8 shadow-elevated">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Q3 Emissions</p>
                    <p className="mt-1 text-3xl font-semibold">142,860 <span className="text-base text-muted-foreground">tCO₂e</span></p>
                  </div>
                  <Badge className="bg-success/10 text-success hover:bg-success/10 border-0">−8.2% YoY</Badge>
                </div>
                <div className="mt-6 grid grid-cols-3 gap-3">
                  {[
                    { label: "Scope 1", value: "62%", color: "bg-chart-1" },
                    { label: "Scope 2", value: "24%", color: "bg-chart-2" },
                    { label: "Scope 3", value: "14%", color: "bg-chart-3" },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl border border-border bg-background/60 p-3">
                      <div className={`mb-2 h-1.5 w-full rounded-full ${s.color}`} />
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                      <p className="text-base font-semibold">{s.value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-6 space-y-2.5">
                  {[
                    { name: "Cement Kiln 01", v: "48,210 tCO₂e", w: "85%" },
                    { name: "Cement Kiln 02", v: "39,540 tCO₂e", w: "70%" },
                    { name: "Grinding Mill", v: "21,900 tCO₂e", w: "39%" },
                    { name: "Logistics Fleet", v: "11,210 tCO₂e", w: "20%" },
                  ].map((row) => (
                    <div key={row.name} className="flex items-center gap-3 text-sm">
                      <span className="w-32 truncate text-muted-foreground">{row.name}</span>
                      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="absolute inset-y-0 left-0 gradient-brand rounded-full" style={{ width: row.w }} />
                      </div>
                      <span className="w-24 text-right font-medium tabular-nums">{row.v}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="absolute -inset-x-6 -bottom-6 -z-10 h-32 rounded-3xl gradient-brand opacity-20 blur-2xl" />
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-t border-border bg-card/30">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="text-center">
            <p className="text-xs font-medium uppercase tracking-wider text-brand">How It Works</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">
              Connect. Analyze. Report — seamlessly.
            </h2>
          </div>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {[
              { n: "01", title: "Connect your data", text: "Upload files or integrate with existing ERP and operational systems." },
              { n: "02", title: "Analyze impact", text: "Advanced models calculate emissions, water usage and intensity." },
              { n: "03", title: "Generate reports", text: "Compliant outputs ready for CBAM submissions and ESG disclosures." },
            ].map((s) => (
              <div key={s.n} className="relative rounded-2xl border border-border bg-card p-6 shadow-soft">
                <span className="text-sm font-mono text-brand">{s.n}</span>
                <h3 className="mt-3 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Market */}
      <section id="market" className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-brand">Target Market</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">
                Heavy industry. Real operations. EU-bound exporters.
              </h2>
              <p className="mt-4 text-muted-foreground">
                We focus where regulatory pressure, emissions intensity and willingness to pay
                converge — starting in MENA and scaling into emerging markets.
              </p>
              <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  { icon: Building2, label: "Cement industry" },
                  { icon: Building2, label: "Manufacturing" },
                  { icon: Globe2, label: "EU exporters" },
                ].map((i) => (
                  <div key={i.label} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-soft">
                    <i.icon className="h-4 w-4 text-brand" />
                    <span className="text-sm font-medium">{i.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-3xl border border-border gradient-card p-8 shadow-soft">
              <h3 className="text-lg font-semibold">Why this market?</h3>
              <ul className="mt-5 space-y-4">
                {[
                  "High emissions intensity and decarbonisation pressure",
                  "Mandatory CBAM reporting starting 2026",
                  "Strong willingness to invest in compliance tooling",
                  "Underserved by generic Western ESG platforms",
                ].map((p) => (
                  <li key={p} className="flex items-start gap-3 text-sm">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    <span className="text-foreground/80">{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="overflow-hidden rounded-3xl gradient-brand p-12 text-center shadow-elevated">
            <h2 className="text-3xl font-semibold tracking-tight text-primary-foreground sm:text-4xl">
              Become CBAM-ready in weeks, not quarters.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-primary-foreground/80">
              Explore both portals — built for industrial customers and Tefnut operators.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" variant="secondary" className="bg-background text-foreground hover:bg-background/90">
                <Link to="/app">Industry Portal</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10">
                <Link to="/admin">Admin Portal</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <TefnutLogo />
          <p>© {new Date().getFullYear()} Tefnut. Sustainability & CBAM compliance for industry.</p>
        </div>
      </footer>
    </div>
  );
}
