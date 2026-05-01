/**
 * Tefnut Auth Context
 * Provides the current user and permission helpers to all React components.
 *
 * Usage:
 *   const { user, can } = useAuth();
 *   if (!user) redirect to /auth/login
 *   if (!can("generate_declaration")) disable the button
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  canExport,
  canGenerateDeclaration,
  canManageOrg,
  canRunCalculation,
  type UserRole,
} from "./auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  orgId: string;
  facilityId: string | null;
}

export type Permission =
  | "run_calculation"
  | "generate_declaration"
  | "export_data"
  | "manage_org"
  | "view_only";

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  can: (permission: Permission) => boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function fetchMe() {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as AuthUser;
        setUser(data);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchMe();
  }, []);

  function can(permission: Permission): boolean {
    if (!user) return false;
    switch (permission) {
      case "generate_declaration": return canGenerateDeclaration(user.role);
      case "run_calculation":      return canRunCalculation(user.role);
      case "export_data":          return canExport(user.role);
      case "manage_org":           return canManageOrg(user.role);
      case "view_only":            return true;
      default:                     return false;
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    window.location.href = "/auth/login";
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: user !== null,
        can,
        logout,
        refresh: fetchMe,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

// ---------------------------------------------------------------------------
// Permission-gated button wrapper
// ---------------------------------------------------------------------------
interface GuardedProps {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Renders children only if the current user has the required permission.
 * Otherwise renders `fallback` (default: a disabled version of the button).
 */
export function PermissionGuard({ permission, children, fallback }: GuardedProps) {
  const { can, isLoading } = useAuth();
  if (isLoading) return null;
  if (can(permission)) return <>{children}</>;
  return fallback ? <>{fallback}</> : null;
}
