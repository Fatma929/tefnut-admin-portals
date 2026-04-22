import { createFileRoute, Outlet } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Leaf,
  FileText,
  Database,
  Building2,
  Settings,
} from "lucide-react";
import { PortalShell, type NavItem } from "@/components/PortalShell";

const nav: NavItem[] = [
  { label: "Dashboard", to: "/app", icon: LayoutDashboard },
  { label: "Emissions", to: "/app/emissions", icon: Leaf },
  { label: "CBAM Reports", to: "/app/reports", icon: FileText, badge: "3" },
  { label: "Data Sources", to: "/app/data", icon: Database },
  { label: "Sites", to: "/app/sites", icon: Building2 },
  { label: "Settings", to: "/app/settings", icon: Settings },
];

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "Industry Portal — Tefnut" },
      {
        name: "description",
        content: "Manage emissions, water footprint and CBAM reporting for your industrial sites.",
      },
    ],
  }),
  component: AppLayout,
});

function AppLayout() {
  return (
    <PortalShell
      nav={nav}
      portalLabel="Industry Portal"
      user={{ name: "Layla Hassan", role: "Sustainability Lead · NileCement", initials: "LH" }}
    >
      <Outlet />
    </PortalShell>
  );
}
