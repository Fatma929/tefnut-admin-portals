import { Link, useLocation } from "@tanstack/react-router";
import { ReactNode } from "react";
import { Bell, Search, ChevronDown, type LucideIcon } from "lucide-react";
import { TefnutLogo } from "./TefnutLogo";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  badge?: string;
  /** ISO standard label shown as a small chip on the nav item */
  isoLabel?: string;
  /** Visual accent: "carbon" = green, "water" = blue */
  accent?: "carbon" | "water";
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

interface PortalShellProps {
  /** Flat list (legacy) or sectioned nav */
  nav: NavItem[] | NavSection[];
  portalLabel: string;
  user: { name: string; role: string; initials: string };
  children: ReactNode;
}

function isSectioned(nav: NavItem[] | NavSection[]): nav is NavSection[] {
  return nav.length > 0 && "items" in nav[0];
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all",
        active
          ? "bg-sidebar-accent text-sidebar-primary shadow-soft"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
      )}
    >
      <Icon className={cn(
        "h-4 w-4 shrink-0",
        item.accent === "carbon" && active && "text-success",
        item.accent === "water" && active && "text-info",
      )} />
      <span className="flex-1 truncate">{item.label}</span>
      {item.isoLabel && (
        <span className={cn(
          "rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wide",
          item.accent === "water"
            ? "bg-info/20 text-info"
            : item.accent === "carbon"
            ? "bg-success/20 text-success"
            : "bg-sidebar-primary/20 text-sidebar-primary",
        )}>
          {item.isoLabel}
        </span>
      )}
      {item.badge && !item.isoLabel && (
        <span className="rounded-full bg-sidebar-primary px-2 py-0.5 text-[10px] font-semibold text-sidebar-primary-foreground">
          {item.badge}
        </span>
      )}
    </Link>
  );
}

export function PortalShell({ nav, portalLabel, user, children }: PortalShellProps) {
  const location = useLocation();

  const isActive = (to: string) =>
    to === "/app" ? location.pathname === to : location.pathname.startsWith(to);

  const renderNav = () => {
    if (isSectioned(nav)) {
      return nav.map((section) => (
        <div key={section.label} className="mb-4">
          <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
            {section.label}
          </p>
          <div className="space-y-0.5">
            {section.items.map((item) => (
              <NavLink key={item.to} item={item} active={isActive(item.to)} />
            ))}
          </div>
        </div>
      ));
    }
    return (
      <div className="space-y-0.5">
        {(nav as NavItem[]).map((item) => (
          <NavLink key={item.to} item={item} active={isActive(item.to)} />
        ))}
      </div>
    );
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 px-5">
          <TefnutLogo variant="light" />
        </div>

        {/* Portal label */}
        <div className="px-4 pb-3">
          <Badge className="bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent border-0 text-[10px]">
            {portalLabel}
          </Badge>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-2">
          {renderNav()}
        </nav>

        {/* ISO Standards footer chip */}
        <div className="border-t border-sidebar-border px-4 py-3">
          <div className="mb-3 flex items-center gap-1.5">
            <span className="rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide bg-success/20 text-success">
              ISO 14064
            </span>
            <span className="text-sidebar-foreground/30 text-[10px]">+</span>
            <span className="rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide bg-info/20 text-info">
              ISO 14046
            </span>
            <span className="ml-auto text-[9px] text-sidebar-foreground/40">GCCA v3.1</span>
          </div>
          {/* User */}
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8 ring-2 ring-sidebar-primary/30">
              <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-[10px] font-semibold">
                {user.initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-sidebar-foreground">{user.name}</p>
              <p className="truncate text-[10px] text-sidebar-foreground/60">{user.role}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-background/80 px-4 backdrop-blur-md lg:px-8">
          <div className="lg:hidden">
            <TefnutLogo />
          </div>
          <div className="relative hidden flex-1 max-w-md md:block">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search reports, sites, suppliers..."
              className="pl-9 bg-muted/50 border-transparent focus-visible:bg-background"
            />
          </div>
          <div className="flex flex-1 items-center justify-end gap-3">
            <Link
              to="/"
              className="hidden rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground sm:inline-flex"
            >
              ← Tefnut.io
            </Link>
            <button className="relative rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
              <Bell className="h-4 w-4" />
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" />
            </button>
            <button className="flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5 text-sm shadow-soft hover:bg-muted">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-brand text-brand-foreground text-[10px] font-semibold">
                  {user.initials}
                </AvatarFallback>
              </Avatar>
              <span className="hidden text-xs font-medium md:inline">{user.name}</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
