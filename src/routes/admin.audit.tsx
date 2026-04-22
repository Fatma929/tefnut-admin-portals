import { createFileRoute } from "@tanstack/react-router";
import { Filter, Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/admin/audit")({
  head: () => ({ meta: [{ title: "Audit log — Tefnut Admin" }] }),
  component: AuditPage,
});

const events = [
  { who: "Layla Hassan", action: "Submitted CBAM Q2 2026", target: "NileCement Group", time: "2 min ago", type: "report" },
  { who: "system", action: "ERP sync completed", target: "Suez Steel Holdings", time: "12 min ago", type: "system" },
  { who: "Fatma Elzahraa", action: "Onboarded new client", target: "Maghreb Cement", time: "1h ago", type: "admin" },
  { who: "Karim Saad", action: "Updated emission factor", target: "Atlas Industries · Kiln 1", time: "3h ago", type: "config" },
  { who: "system", action: "Anomaly detected", target: "NileCement · Grinding Mill", time: "5h ago", type: "alert" },
  { who: "Nour Hadid", action: "Generated CBAM draft", target: "Levant Manufacturing", time: "Yesterday", type: "report" },
  { who: "Fatma Elzahraa", action: "Changed plan to Enterprise", target: "Gulf Aluminum Co.", time: "Yesterday", type: "admin" },
  { who: "system", action: "Storage tier upgraded", target: "platform", time: "2 days ago", type: "system" },
  { who: "Tareq Idrissi", action: "Invited 4 users", target: "Kairos Fertilizers", time: "3 days ago", type: "admin" },
];

const typeMap = {
  report: "bg-info/10 text-info",
  system: "bg-muted text-muted-foreground",
  admin: "bg-brand-muted text-brand",
  config: "bg-accent text-accent-foreground",
  alert: "bg-warning/10 text-warning-foreground",
};

function AuditPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Security"
        title="Audit log"
        description="Immutable trail of every action across tenants and the platform."
        actions={<Button variant="outline" size="sm"><Filter className="mr-2 h-4 w-4" /> Filter</Button>}
      />

      <div className="rounded-2xl border border-border bg-card shadow-soft">
        <div className="border-b border-border p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search by user, action or tenant..." className="pl-9 bg-muted/50 border-transparent" />
          </div>
        </div>
        <div className="divide-y divide-border">
          {events.map((e, i) => (
            <div key={i} className="flex flex-wrap items-center gap-3 p-4 text-sm">
              <Badge variant="outline" className={typeMap[e.type as keyof typeof typeMap] + " text-[10px] uppercase border-0"}>
                {e.type}
              </Badge>
              <span className="font-medium">{e.who}</span>
              <span className="text-muted-foreground">{e.action}</span>
              <span className="font-medium text-foreground">→ {e.target}</span>
              <span className="ml-auto text-xs text-muted-foreground">{e.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
