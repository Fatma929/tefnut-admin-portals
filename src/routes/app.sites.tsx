import { createFileRoute } from "@tanstack/react-router";
import { Building2, MapPin, Plus, Users } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/app/sites")({
  head: () => ({ meta: [{ title: "Sites — Tefnut" }] }),
  component: SitesPage,
});

const sites = [
  { name: "Cement Plant — Suez", country: "Egypt", type: "Cement", capacity: "5.2 Mt/y", staff: 612, intensity: "0.82", status: "Operational" },
  { name: "Cement Plant — Helwan", country: "Egypt", type: "Cement", capacity: "4.6 Mt/y", staff: 540, intensity: "0.79", status: "Operational" },
  { name: "Grinding Mill — Alexandria", country: "Egypt", type: "Grinding", capacity: "2.1 Mt/y", staff: 180, intensity: "0.41", status: "Operational" },
  { name: "Logistics Hub — Cairo", country: "Egypt", type: "Logistics", capacity: "—", staff: 95, intensity: "0.12", status: "Operational" },
  { name: "Quarry — Minya", country: "Egypt", type: "Quarry", capacity: "8.0 Mt/y", staff: 120, intensity: "0.38", status: "Maintenance" },
];

function SitesPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Operations"
        title="Sites"
        description="All industrial sites under your sustainability scope."
        actions={
          <Button size="sm" className="gradient-brand text-primary-foreground border-0 hover:opacity-90">
            <Plus className="mr-2 h-4 w-4" /> Register site
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sites.map((s) => (
          <div key={s.name} className="group rounded-2xl border border-border bg-card p-5 shadow-soft transition-all hover:shadow-elevated">
            <div className="flex items-start justify-between">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-muted text-brand">
                <Building2 className="h-5 w-5" />
              </div>
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
            <h3 className="mt-4 font-semibold tracking-tight">{s.name}</h3>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" /> {s.country} · {s.type}
            </p>
            <div className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Capacity</p>
                <p className="mt-1 text-sm font-semibold">{s.capacity}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Intensity</p>
                <p className="mt-1 text-sm font-semibold">{s.intensity}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Staff</p>
                <p className="mt-1 flex items-center gap-1 text-sm font-semibold">
                  <Users className="h-3 w-3 text-muted-foreground" /> {s.staff}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
