"use client";
import { useState, Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { signIn, useSession } from "@/lib/auth-client";

function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/admin";
  const { data: session, isPending: sessionPending } = useSession();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // If the user already has a valid session, redirect them away from the login
  // page. This replaces the previous middleware-based redirect that caused
  // redirect loops when a stale session cookie was present.
  useEffect(() => {
    if (sessionPending || !session) return;

    const mustReset = (session.user as { mustResetPassword?: boolean }).mustResetPassword;
    if (mustReset) {
      document.cookie = "admin.must_reset=1; path=/; max-age=600";
      router.push("/reset-password?force=1");
    } else {
      router.push(callbackUrl);
    }
    router.refresh();
  }, [session, sessionPending, callbackUrl, router]);

  const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      let result;
      if (isEmail(identifier)) {
        result = await signIn.email({
          email: identifier,
          password,
        });
      } else {
        result = await signIn.username({
          username: identifier,
          password,
        });
      }

      if (result.error) {
        setError(result.error.message || "Email/username atau password salah");
      } else {
        // The sign-in cookie is set, but the Better Auth client session cache
        // may not have refreshed yet. Fetch a dedicated server endpoint that
        // reads the session server-side (cookie is sent automatically) to get
        // the authoritative mustResetPassword value.
        try {
          const checkRes = await fetch("/api/admin/session-check", {
            cache: "no-store",
          });
          const checkJson = await checkRes.json();
          const mustReset = checkJson?.mustResetPassword === true;

          if (mustReset) {
            // Set a lightweight edge cookie so middleware can gate without a
            // DB hit on every request. Not httpOnly so the client can clear it
            // after a successful reset.
            document.cookie = "admin.must_reset=1; path=/; max-age=600"; // 10 min
            router.push("/reset-password?force=1");
            router.refresh();
          } else {
            router.push(callbackUrl);
            router.refresh();
          }
        } catch {
          // If the check fails, default to the callback URL (safe fallback)
          router.push(callbackUrl);
          router.refresh();
        }
      }
    } catch (err) {
      console.error("Admin login error:", err);
      setError("Terjadi kesalahan. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  // Show a brief loading state while the client session is being resolved so
  // authenticated users don't see a flash of the login form before redirecting.
  if (sessionPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4 py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-16">
      <Card className="w-full max-w-md shadow-lg border-muted/40">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">
            Admin Login
          </CardTitle>
          <CardDescription className="text-center text-muted-foreground">
            Masuk sebagai admin dengan email atau username.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identifier">
                Email atau Username
              </Label>
              <Input
                id="identifier"
                type="text"
                placeholder="admin@store.com / admin"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Memproses..." : "Masuk"}
            </Button>
          </form>

          <div className="text-center">
            <Link
              href="/forgot-password"
              className="text-sm text-primary hover:underline underline-offset-4"
            >
              Lupa password?
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <AdminLoginForm />
    </Suspense>
  );
}
