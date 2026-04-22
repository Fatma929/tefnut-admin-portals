import { createFileRoute, Outlet } from "@tanstack/react-router";
import {
  BarChart3,
  Building2,
  Database,
  Droplets,
  FileText,
  History,
  LayoutDashboard,
  Leaf,
  Settings,
} from "lucide-react";
import { PortalShell, type NavSection } from "@/components/PortalShell";

const nav: NavSection[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", to: "/app", icon: LayoutDashboard },
    ],
  },
  {
    label: "Footprint Engines",
    items: [
      {
        label: "Carbon Footprint",
        to: "/app/emissions",
        icon: Leaf,
        isoLabel: "ISO 14064",
        accent: "carbon",
      },
      {
        label: "Water Footprint",
        to: "/app/data",
        icon: Droplets,
        isoLabel: "ISO 14046",
        accent: "water",
      },
    ],
  },
  {
    label: "Compliance",
    items: [
      { label: "CBAM Reports", to: "/app/reports", icon: FileText, badge: "3" },
      { label: "Analytics", to: "/app/emissions", icon: BarChart3 },
      { label: "Report History", to: "/app/history", icon: History },
    ],
  },
  {
    label: "Management",
    items: [
      { label: "Data Sources", to: "/app/data", icon: Database },
      { label: "Sites", to: "/app/sites", icon: Building2 },
      { label: "Settings", to: "/app/settings", icon: Settings },
    ],
  },
];

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "Industry Portal — Tefnut" },
      {
        name: "description",
        content: "Manage carbon and water footprints with ISO 14064 & ISO 14046 compliance.",
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
