import { createFileRoute, Outlet } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  FileCheck2,
  ServerCog,
  Activity,
  ShieldCheck,
} from "lucide-react";
import { PortalShell, type NavItem } from "@/components/PortalShell";

const nav: NavItem[] = [
  { label: "Overview", to: "/admin", icon: LayoutDashboard },
  { label: "Clients", to: "/admin/clients", icon: Users, badge: "47" },
  { label: "Compliance", to: "/admin/compliance", icon: FileCheck2 },
  { label: "Platform", to: "/admin/platform", icon: ServerCog },
  { label: "Audit log", to: "/admin/audit", icon: Activity },
  { label: "Security", to: "/admin/security", icon: ShieldCheck },
];

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin Console — Tefnut" },
      {
        name: "description",
        content: "Tefnut admin console — manage industrial customers, oversee CBAM compliance and monitor platform health.",
      },
    ],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <PortalShell
      nav={nav}
      portalLabel="Admin Console"
      user={{ name: "Fatma Elzahraa", role: "Platform Admin · Tefnut", initials: "FE" }}
    >
      <Outlet />
    </PortalShell>
  );
}
