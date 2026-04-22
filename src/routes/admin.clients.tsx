import { createFileRoute } from "@tanstack/react-router";
import { Building2, MoreHorizontal, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/admin/clients")({
  head: () => ({ meta: [{ title: "Clients — Tefnut Admin" }] }),
  component: ClientsPage,
});

const clients = [
  { name: "NileCement Group", industry: "Cement", country: "Egypt", plan: "Enterprise", users: 42, status: "active" },
  { name: "Suez Steel Holdings", industry: "Steel", country: "Egypt", plan: "Enterprise", users: 31, status: "active" },
  { name: "Atlas Industries", industry: "Cement", country: "Morocco", plan: "Growth", users: 18, status: "trial" },
  { name: "Levant Manufacturing", industry: "Manufacturing", country: "Jordan", plan: "Growth", users: 15, status: "active" },
  { name: "Gulf Aluminum Co.", industry: "Aluminum", country: "UAE", plan: "Enterprise", users: 24, status: "active" },
  { name: "Kairos Fertilizers", industry: "Chemicals", country: "Egypt", plan: "Growth", users: 11, status: "active" },
  { name: "Maghreb Cement", industry: "Cement", country: "Tunisia", plan: "Starter", users: 6, status: "onboarding" },
  { name: "Red Sea Glass Works", industry: "Glass", country: "Saudi Arabia", plan: "Growth", users: 9, status: "paused" },
];

const statusMap = {
  active: "bg-success/10 text-success border-success/30",
  trial: "bg-info/10 text-info border-info/30",
  onboarding: "bg-warning/10 text-warning-foreground border-warning/30",
  paused: "bg-muted text-muted-foreground border-border",
};

function ClientsPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Customers"
        title="Clients"
        description="All industrial customers using Tefnut for sustainability and CBAM compliance."
        actions={
          <Button size="sm" className="gradient-brand text-primary-foreground border-0 hover:opacity-90">
            <Plus className="mr-2 h-4 w-4" /> Onboard client
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: "Total clients", v: "47" },
          { label: "Enterprise", v: "18" },
          { label: "Growth", v: "21" },
          { label: "Trial / onboarding", v: "8" },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</p>
            <p className="mt-2 text-2xl font-semibold">{s.v}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card shadow-soft">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search clients..." className="pl-9 bg-muted/50 border-transparent" />
          </div>
          <Button variant="outline" size="sm">Industry</Button>
          <Button variant="outline" size="sm">Country</Button>
          <Button variant="outline" size="sm">Plan</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Industry</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Users</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((c) => (
              <TableRow key={c.name}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-brand-muted text-brand text-xs">
                        <Building2 className="h-3.5 w-3.5" />
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium">{c.name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{c.industry}</TableCell>
                <TableCell className="text-muted-foreground">{c.country}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[11px]">{c.plan}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{c.users}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={statusMap[c.status as keyof typeof statusMap]}>
                    {c.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" className="h-8 w-8">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
