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
}

interface PortalShellProps {
  nav: NavItem[];
  portalLabel: string;
  user: { name: string; role: string; initials: string };
  children: ReactNode;
}

export function PortalShell({ nav, portalLabel, user, children }: PortalShellProps) {
  const location = useLocation();

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-16 items-center px-6">
          <TefnutLogo variant="light" />
        </div>
        <div className="px-4 pb-3">
          <Badge className="bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent border-0">
            {portalLabel}
          </Badge>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2">
          {nav.map((item) => {
            const active =
              item.to === "/"
                ? location.pathname === item.to
                : location.pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all",
                  active
                    ? "bg-sidebar-accent text-sidebar-primary shadow-soft"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1">{item.label}</span>
                {item.badge && (
                  <span className="rounded-full bg-sidebar-primary px-2 py-0.5 text-[10px] font-semibold text-sidebar-primary-foreground">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-9 w-9 ring-2 ring-sidebar-primary/30">
              <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs font-semibold">
                {user.initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-sidebar-foreground">{user.name}</p>
              <p className="truncate text-xs text-sidebar-foreground/60">{user.role}</p>
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
