"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
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

// Client form component for the admin login page.
//
// Navigation after a successful sign-in uses a hard browser navigation
// (`window.location.href`) inside Better Auth's `fetchOptions.onSuccess`
// callback rather than `router.push` + `router.refresh`. Two reasons:
//
// 1. Router Cache replay: in production, the Next.js client Router Cache can
//    hold the RSC payload for `/admin` from a previous (pre-auth) visit that
//    redirected to `/login`. `router.push("/admin")` would replay that cached
//    redirect, making the login look like it failed (user has to click twice).
//    A hard navigation bypasses the Router Cache entirely.
//
// 2. Idiomatic Better Auth: the docs put post-auth navigation inside
//    `fetchOptions.onSuccess`, which fires after the Set-Cookie response has
//    been processed. Navigating after a plain `await signIn.email(...)` can
//    race the cookie being applied to `document.cookie` on some browsers.
//
// We additionally fetch `/api/admin/session-check` from inside onSuccess to
// get the authoritative `mustResetPassword` value (read server-side from the
// just-set cookie) and branch the redirect target accordingly.
export default function AdminLoginForm() {
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

    const navigateAfterLogin = async () => {
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
          window.location.href = "/reset-password?force=1";
        } else {
          window.location.href = callbackUrl;
        }
      } catch {
        // If the check fails, default to the callback URL (safe fallback).
        window.location.href = callbackUrl;
      }
    };

    try {
      const fetchOptions = {
        onSuccess: () => {
          // Fire-and-forget; hard navigation happens inside.
          void navigateAfterLogin();
        },
        onError: (ctx: { response: Response }) => {
          // Better Auth surfaces non-2xx responses here. Try to read the
          // JSON body for a localized message; fall back to a generic error.
          ctx.response
            .json()
            .then((body: { message?: string } | null) => {
              setError(
                (body && body.message) ||
                  "Email/username atau password salah"
              );
            })
            .catch(() => {
              setError("Email/username atau password salah");
            })
            .finally(() => setLoading(false));
        },
      };

      if (isEmail(identifier)) {
        await signIn.email(
          { email: identifier, password },
          fetchOptions
        );
      } else {
        await signIn.username(
          { username: identifier, password },
          fetchOptions
        );
      }
      // On success, onSuccess navigates away (this component unmounts).
      // On error, onError sets the error message and re-enables the button.
      // If neither fires (unexpected), keep loading state so the user isn't
      // stuck — but log it so we can detect the edge case in dev.
    } catch (err) {
      console.error("Admin login error:", err);
      setError("Terjadi kesalahan. Silakan coba lagi.");
      setLoading(false);
    }
  };

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
              <Label htmlFor="identifier">Email atau Username</Label>
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
              <Label htmlFor="password">Password</Label>
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