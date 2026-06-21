"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
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
import { signIn } from "@/lib/auth-client";

function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/admin";

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <Card className="w-full max-w-md shadow-lg border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">
            Admin Login
          </CardTitle>
          <CardDescription className="text-center text-slate-400">
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
              <Label htmlFor="identifier" className="text-slate-300">
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
                className="bg-slate-950 border-slate-700"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-300">
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
                className="bg-slate-950 border-slate-700"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Memproses..." : "Masuk"}
            </Button>
          </form>

          <div className="text-center">
            <Link
              href="/forgot-password"
              className="text-sm text-slate-400 hover:text-slate-200 underline underline-offset-4"
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
