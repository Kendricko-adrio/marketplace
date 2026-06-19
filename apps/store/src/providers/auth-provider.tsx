"use client";
import { createContext, useContext, ReactNode } from "react";
import { useSession as useBetterAuthSession } from "@/lib/auth-client";

interface User {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  role?: string;
  emailVerified?: boolean;
  onboardingCompleted?: boolean;
  phone?: string | null;
  birthDate?: string | null;
  gender?: string | null;
}

interface Session {
  user: User;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  isLoading: true,
  isAuthenticated: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useBetterAuthSession();

  const value: AuthContextType = {
    user: session?.user || null,
    session: session || null,
    isLoading: isPending,
    isAuthenticated: !!session?.user,
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