import { createFileRoute } from "@tanstack/react-router";
import { Bell, Building2, Globe, Lock, Save, User } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

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
      </div>
    </div>
  );
}
