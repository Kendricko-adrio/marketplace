/* eslint-disable react-hooks/set-state-in-effect */
"use client";
import { createContext, useContext, ReactNode, useEffect, useState, useCallback } from "react";
import { useSession as useBetterAuthSession } from "@/lib/auth-client";
import type { PermissionMap, ModuleName, PermissionAction } from "@/db";

interface User {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  role?: string;
  [key: string]: unknown;
}

interface Session {
  user: User;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  permissions: PermissionMap | null;
  permissionsLoading: boolean;
  hasPermission: (moduleName: ModuleName, action: PermissionAction) => boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  isLoading: true,
  isAuthenticated: false,
  permissions: null,
  permissionsLoading: true,
  hasPermission: () => false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useBetterAuthSession();
  const user = (session?.user as User | undefined) ?? null;
  const userId = user?.id;
  const userRole = user?.role;
  const [permissions, setPermissions] = useState<PermissionMap | null>(null);
  const [permissionsLoading, setPermissionsLoading] = useState(true);

  useEffect(() => {
    if (!userId || !userRole) {
      setPermissions(null);
      setPermissionsLoading(false);
      return;
    }

    let cancelled = false;
    setPermissionsLoading(true);

    fetch("/api/admin/permissions/me")
      .then((res) => res.json())
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.data?.permissions) {
          setPermissions(result.data.permissions);
        } else {
          setPermissions(null);
        }
      })
      .catch((err) => {
        console.error("Failed to load permissions:", err);
        if (!cancelled) setPermissions(null);
      })
      .finally(() => {
        if (!cancelled) setPermissionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId, userRole]);

  const hasPermission = useCallback(
    (moduleName: ModuleName, action: PermissionAction): boolean => {
      if (!permissions) return false;
      const p = permissions[moduleName];
      if (!p) return false;
      if (action === "view") return p.canView;
      if (action === "edit") return p.canEdit;
      if (action === "delete") return p.canDelete;
      return false;
    },
    [permissions]
  );

  const value: AuthContextType = {
    user: user || null,
    session: session || null,
    isLoading: isPending,
    isAuthenticated: !!user,
    permissions,
    permissionsLoading,
    hasPermission,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
