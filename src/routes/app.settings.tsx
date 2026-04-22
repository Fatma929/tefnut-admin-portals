import { createFileRoute } from "@tanstack/react-router";
import { Bell, Building2, Globe, Lock, Save, ShieldCheck, User } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/settings")({
  head: () => ({ meta: [{ title: "Settings — Tefnut" }] }),
  component: SettingsPage,
});

function Section({ icon: Icon, title, description, children }: { icon: typeof User; title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-muted text-brand">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <h3 className="font-semibold tracking-tight">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-5 space-y-4">{children}</div>
    </div>
  );
}

function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Manage your organisation, profile and platform preferences."
        actions={
          <Button size="sm" className="gradient-brand text-primary-foreground border-0 hover:opacity-90">
            <Save className="mr-2 h-4 w-4" /> Save changes
          </Button>
        }
      />

      <div className="space-y-6">
        <Section icon={Building2} title="Organisation" description="Company-level settings used across all reports.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Legal name</Label>
              <Input defaultValue="NileCement Group S.A.E." />
            </div>
            <div className="space-y-2">
              <Label>EORI number</Label>
              <Input defaultValue="EG23045890015" />
            </div>
            <div className="space-y-2">
              <Label>Headquarters country</Label>
              <Input defaultValue="Egypt" />
            </div>
            <div className="space-y-2">
              <Label>Reporting currency</Label>
              <Input defaultValue="EUR" />
            </div>
          </div>
        </Section>

        <Section icon={User} title="Profile" description="Your personal details and contact information.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Full name</Label>
              <Input defaultValue="Layla Hassan" />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Input defaultValue="Sustainability Lead" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Work email</Label>
              <Input type="email" defaultValue="layla.hassan@nilecement.eg" />
            </div>
          </div>
        </Section>

        <Section icon={Bell} title="Notifications" description="Choose which alerts reach your inbox.">
          {[
            { label: "CBAM filing deadlines", desc: "Reminders 30, 14 and 3 days before each deadline.", on: true },
            { label: "Data anomaly detection", desc: "When emissions or energy spike outside normal ranges.", on: true },
            { label: "Weekly sustainability digest", desc: "Summary of progress against your reduction targets.", on: false },
          ].map((n) => (
            <div key={n.label} className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background p-4">
              <div>
                <p className="text-sm font-medium">{n.label}</p>
                <p className="text-xs text-muted-foreground">{n.desc}</p>
              </div>
              <Switch defaultChecked={n.on} />
            </div>
          ))}
        </Section>

        <Section icon={Lock} title="Security" description="Protect your account and data.">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background p-4">
            <div>
              <p className="text-sm font-medium">Two-factor authentication</p>
              <p className="text-xs text-muted-foreground">Required for all administrators.</p>
            </div>
            <Switch defaultChecked />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background p-4">
            <div>
              <p className="text-sm font-medium">Session timeout</p>
              <p className="text-xs text-muted-foreground">Auto sign-out after inactivity.</p>
            </div>
            <span className="text-sm font-medium">30 min</span>
          </div>
        </Section>

        <Section icon={Globe} title="Region & locale" description="Localisation preferences for the interface.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Language</Label>
              <Input defaultValue="English" />
            </div>
            <div className="space-y-2">
              <Label>Time zone</Label>
              <Input defaultValue="Africa/Cairo (UTC+2)" />
            </div>
          </div>
        </Section>

        <StandardsSelector />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Standards Selector
// ---------------------------------------------------------------------------
const STANDARDS = [
  {
    id: "iso-14064",
    name: "ISO 14064-1:2018",
    description: "GHG Inventory — Carbon Footprint",
    detail: "Quantification and reporting of GHG emissions at the organizational level. Used by the Carbon Engine.",
    accent: "success" as const,
    defaultOn: true,
  },
  {
    id: "iso-14046",
    name: "ISO 14046:2014",
    description: "Water Footprint Assessment",
    detail: "Principles, requirements and guidelines for water footprint of products, processes and organizations. Used by the Water Engine.",
    accent: "info" as const,
    defaultOn: true,
  },
  {
    id: "gcca-carbon",
    name: "GCCA CO₂ Protocol v3.1",
    description: "Cement & Energy Protocol",
    detail: "GCCA Cement CO₂ and Energy Protocol — the industry-specific quantification methodology underpinning the Carbon Engine.",
    accent: "success" as const,
    defaultOn: true,
  },
  {
    id: "gcca-water",
    name: "GCCA Water Guidelines 2021",
    description: "Water Management for Cement",
    detail: "GCCA Water Management Guidelines for the Cement Industry — defines KPI 1 (Consumption) and KPI 2 (Intensity) used by the Water Engine.",
    accent: "info" as const,
    defaultOn: true,
  },
  {
    id: "eu-cbam",
    name: "EU CBAM Regulation 2023/956",
    description: "Carbon Border Adjustment Mechanism",
    detail: "EU regulation requiring embedded carbon reporting for cement imports. Drives the CBAM Reports module.",
    accent: "brand" as const,
    defaultOn: true,
  },
  {
    id: "ipcc-ar6",
    name: "IPCC AR6 GWP Values",
    description: "Global Warming Potentials",
    detail: "GWP100 values from the IPCC Sixth Assessment Report (2021), as required by ISO 14064-1:2018.",
    accent: "brand" as const,
    defaultOn: true,
  },
];

const accentClasses: Record<string, { badge: string; dot: string }> = {
  success: { badge: "bg-success/10 text-success border-success/30", dot: "bg-success" },
  info: { badge: "bg-info/10 text-info border-info/30", dot: "bg-info" },
  brand: { badge: "bg-brand-muted text-brand border-brand/20", dot: "bg-brand" },
};

function StandardsSelector() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    Object.fromEntries(STANDARDS.map((s) => [s.id, s.defaultOn])),
  );

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-muted text-brand">
          <ShieldCheck className="h-4 w-4" />
        </div>
        <div>
          <h3 className="font-semibold tracking-tight">Standards & Frameworks</h3>
          <p className="text-sm text-muted-foreground">
            Tefnut is built on these ISO and GCCA frameworks. Toggle visibility in reports.
          </p>
        </div>
      </div>
      <div className="mt-5 space-y-3">
        {STANDARDS.map((s) => {
          const cfg = accentClasses[s.accent];
          return (
            <div
              key={s.id}
              className={cn(
                "flex items-start gap-4 rounded-xl border p-4 transition-colors",
                enabled[s.id] ? "border-border bg-background" : "border-border/50 bg-muted/20 opacity-60",
              )}
            >
              <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", cfg.dot)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{s.name}</p>
                  <Badge variant="outline" className={cn("text-[10px]", cfg.badge)}>
                    {s.description}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.detail}</p>
              </div>
              <Switch
                checked={enabled[s.id]}
                onCheckedChange={(v) => setEnabled((prev) => ({ ...prev, [s.id]: v }))}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
