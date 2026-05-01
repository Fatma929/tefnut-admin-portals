import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
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
import { AuthProvider, useAuth } from "@/lib/auth-context";

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
  // Server-side auth guard — redirect to login if no valid token
  beforeLoad: async ({ context: _ctx, location }) => {
    // In TanStack Start, we check the cookie server-side via a loader
    // The client-side guard below handles the React layer
    void location;
  },
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
    <AuthProvider>
      <AuthGuard>
        <AppShell />
      </AuthGuard>
    </AuthProvider>
  );
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // Client-side redirect
    window.location.replace("/auth/login?from=" + encodeURIComponent(window.location.pathname));
    return null;
  }

  return <>{children}</>;
}

function AppShell() {
  const { user, logout } = useAuth();

  const displayName = user?.email?.split("@")[0] ?? "User";
  const roleLabel = user?.role
    ? user.role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Analyst";

  return (
    <PortalShell
      nav={nav}
      portalLabel="Industry Portal"
      user={{
        name: displayName,
        role: roleLabel,
        initials: displayName.slice(0, 2).toUpperCase(),
        onLogout: logout,
      }}
    >
      <Outlet />
    </PortalShell>
  );
}
