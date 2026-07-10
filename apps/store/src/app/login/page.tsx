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
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { signIn, authClient } from "@/lib/auth-client";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState("");

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNeedsVerification(false);
    setLoading(true);

    // Clear stale onboarding cookie so the gate evaluates fresh for this user.
    document.cookie = "client.onboarding=; path=/; max-age=0";

    try {
      const result = await signIn.email({
        email,
        password,
      });

      if (result.error) {
        const msg = result.error.message || "Email atau password salah";
        // Better Auth returns this when requireEmailVerification is on.
        if (
          msg.toLowerCase().includes("verify") ||
          msg.toLowerCase().includes("verifikasi") ||
          msg.toLowerCase().includes("email is not verified")
        ) {
          setNeedsVerification(true);
          setError(msg);
        } else {
          setError(msg);
        }
      } else {
        // Let middleware route to /onboarding if needed, otherwise callbackUrl.
        router.push(callbackUrl);
        router.refresh();
      }
    } catch (err) {
      console.error("Login error:", err);
      setError("Terjadi kesalahan. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!email) return;
    setResending(true);
    setResendMessage("");

    try {
      const res = await authClient.sendVerificationEmail({
        email,
        callbackURL: "/onboarding",
      });

      if (res.error) {
        setResendMessage(res.error.message || "Gagal mengirim ulang email.");
      } else {
        setResendMessage("Email verifikasi telah dikirim ulang. Cek kotak masuk Anda.");
      }
    } catch (err) {
      console.error("Resend verification error:", err);
      setResendMessage("Terjadi kesalahan. Silakan coba lagi.");
    } finally {
      setResending(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError("");
    setLoading(true);

    // Clear stale onboarding cookie so the gate evaluates fresh for this user.
    document.cookie = "client.onboarding=; path=/; max-age=0";

    try {
      // New Google users go to onboarding; returning users go home.
      // (Middleware will still gate home if onboarding isn't done.)
      await signIn.social({
        provider: "google",
        callbackURL: "/",
        newUserCallbackURL: "/onboarding",
      });
    } catch (err) {
      console.error("Google login error:", err);
      setError("Gagal login dengan Google");
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-16 flex justify-center items-center min-h-[calc(100vh-4rem)]">
      <Card className="w-full max-w-md shadow-lg border-muted/40">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">
            Masuk Akun
          </CardTitle>
          <CardDescription className="text-center">
            Selamat datang kembali! Silakan masuk untuk melanjutkan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
              {error}
            </div>
          )}

          {needsVerification && (
            <div className="bg-muted text-foreground text-sm p-3 rounded-md space-y-2">
              <p>
                Email Anda belum diverifikasi. Silakan cek email Anda untuk
                tautan verifikasi.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleResendVerification}
                disabled={resending || !email}
              >
                {resending ? "Mengirim..." : "Kirim ulang email verifikasi"}
              </Button>
              {resendMessage && <p className="text-xs">{resendMessage}</p>}
            </div>
          )}

          <Button
            variant="outline"
            className="w-full gap-2 relative h-10"
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading}
          >
            <div className="absolute left-3 flex items-center justify-center bg-white rounded-full p-0.5">
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
            </div>
            {loading ? "Memproses..." : "Masuk dengan Google"}
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <Separator />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Atau masuk dengan email
              </span>
            </div>
          </div>

          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="mb-1.5 block">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="nama@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="mb-1.5 block">
                  Password
                </Label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-primary hover:underline"
                >
                  Lupa password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
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
        </CardContent>
        <CardFooter className="flex justify-center">
          <p className="text-sm text-muted-foreground">
            Belum punya akun?{" "}
            <Link
              href="/register"
              className="text-primary hover:underline font-medium"
            >
              Daftar sekarang
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
