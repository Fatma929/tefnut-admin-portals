import { createFileRoute } from "@tanstack/react-router";
import { Key, Lock, ShieldCheck, UserCheck } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin/security")({
  head: () => ({ meta: [{ title: "Security — Tefnut Admin" }] }),
  component: SecurityPage,
});

function SecurityPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Trust"
        title="Security & access"
        description="Enforce platform-wide security policies and manage administrator access."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Admins", v: "6", icon: UserCheck },
          { label: "Active SSO providers", v: "3", icon: Key },
          { label: "Compliance frameworks", v: "ISO 27001 · SOC 2", icon: ShieldCheck },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <s.icon className="h-4 w-4 text-brand" />
            </div>
            <p className="mt-2 text-lg font-semibold">{s.v}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        {[
          { title: "Enforce MFA for all admins", desc: "Require time-based one-time passwords or hardware keys.", on: true },
          { title: "Restrict access to allow-listed IPs", desc: "Limit admin console to corporate networks.", on: false },
          { title: "Auto-rotate API keys every 90 days", desc: "All tenants are forced to refresh integration credentials.", on: true },
          { title: "Encrypt CBAM submissions at rest", desc: "AES-256 with per-tenant data keys.", on: true },
          { title: "Send weekly security digest", desc: "Summary of access events and anomalies to admins.", on: false },
        ].map((p) => (
          <div key={p.title} className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-muted text-brand">
                <Lock className="h-4 w-4" />
              </div>
              <div>
                <p className="font-medium">{p.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{p.desc}</p>
              </div>
            </div>
            <Switch defaultChecked={p.on} />
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-border gradient-card p-6 shadow-soft">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold tracking-tight">Compliance & certifications</h3>
            <p className="text-sm text-muted-foreground">Tefnut maintains independent third-party attestations.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="outline" className="bg-card">ISO 27001</Badge>
              <Badge variant="outline" className="bg-card">SOC 2 Type II</Badge>
              <Badge variant="outline" className="bg-card">GDPR</Badge>
              <Badge variant="outline" className="bg-card">EU CBAM aligned</Badge>
            </div>
          </div>
          <Button variant="outline">Download trust pack</Button>
        </div>
      </div>
    </div>
  );
}
