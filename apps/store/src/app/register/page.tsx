"use client";
import { useState } from "react";
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
import { signUp, signIn, authClient } from "@/lib/auth-client";

const RESEND_COOLDOWN_SECONDS = 60;

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // After successful signUp we show the "check your email" state.
  const [emailSent, setEmailSent] = useState(false);

  // Resend state
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState("");
  const [cooldown, setCooldown] = useState(0);

  const startCooldown = () => {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    const interval = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Password tidak sama");
      return;
    }

    if (password.length < 8) {
      setError("Password minimal 8 karakter");
      return;
    }

    setLoading(true);

    try {
      const result = await signUp.email({
        email,
        password,
        name,
        callbackURL: "/onboarding",
      });

      if (result.error) {
        setError(result.error.message || "Gagal mendaftar");
      } else {
        // Do NOT auto-login. Better Auth already sent the verification email
        // (sendOnSignUp: true). Show the "check your email" screen.
        setEmailSent(true);
        startCooldown();
      }
    } catch (err) {
      console.error("Register error:", err);
      setError("Terjadi kesalahan. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  const handleResendEmail = async () => {
    if (cooldown > 0 || !email) return;
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
        setResendMessage("Email verifikasi telah dikirim ulang.");
        startCooldown();
      }
    } catch (err) {
      console.error("Resend error:", err);
      setResendMessage("Terjadi kesalahan. Silakan coba lagi.");
    } finally {
      setResending(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setError("");
    setLoading(true);

    try {
      // Google users skip email verification (auto-verified in db hook).
      // After the callback, middleware will route them to /onboarding.
      await signIn.social({
        provider: "google",
        callbackURL: "/onboarding",
      });
    } catch (err) {
      console.error("Google signup error:", err);
      setError("Gagal mendaftar dengan Google");
      setLoading(false);
    }
  };

  // ---------- "Check your email" state ----------
  if (emailSent) {
    return (
      <div className="container mx-auto px-4 py-16 flex justify-center items-center min-h-[calc(100vh-4rem)]">
        <Card className="w-full max-w-md shadow-lg border-muted/40">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold text-center">
              Cek Email Anda
            </CardTitle>
            <CardDescription className="text-center">
              Kami telah mengirim tautan verifikasi ke{" "}
              <strong className="text-foreground">{email}</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              Klik tautan di dalam email untuk memverifikasi alamat Anda dan
              melanjutkan ke pengisian data identitas. Tautan ini kedaluwarsa
              dalam 1 jam.
            </p>

            {resendMessage && (
              <div className="bg-muted text-foreground text-sm p-3 rounded-md text-center">
                {resendMessage}
              </div>
            )}

            <Button
              variant="outline"
              className="w-full"
              onClick={handleResendEmail}
              disabled={resending || cooldown > 0}
            >
              {resending
                ? "Mengirim..."
                : cooldown > 0
                  ? `Kirim ulang dalam ${cooldown}s`
                  : "Kirim ulang email verifikasi"}
            </Button>
          </CardContent>
          <CardFooter className="flex justify-center">
            <p className="text-sm text-muted-foreground">
              Sudah punya akun?{" "}
              <Link
                href="/login"
                className="text-primary hover:underline font-medium"
              >
                Masuk sekarang
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // ---------- Default registration form ----------
  return (
    <div className="container mx-auto px-4 py-16 flex justify-center items-center min-h-[calc(100vh-4rem)]">
      <Card className="w-full max-w-md shadow-lg border-muted/40">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">
            Daftar Akun
          </CardTitle>
          <CardDescription className="text-center">
            Buat akun baru untuk mulai berbelanja.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
              {error}
            </div>
          )}

          <Button
            variant="outline"
            className="w-full gap-2 relative h-10"
            type="button"
            onClick={handleGoogleSignUp}
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
            {loading ? "Memproses..." : "Daftar dengan Google"}
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <Separator />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Atau daftar dengan email
              </span>
            </div>
          </div>

          <form onSubmit={handleRegister} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nama Lengkap</Label>
              <Input
                id="name"
                type="text"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
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
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Minimal 8 karakter"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Konfirmasi Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Ulangi password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Memproses..." : "Daftar"}
            </Button>
          </form>

          <p className="text-xs text-center text-muted-foreground">
            Dengan mendaftar, Anda menyetujui{" "}
            <Link href="/terms" className="text-primary hover:underline">
              Syarat & Ketentuan
            </Link>{" "}
            dan{" "}
            <Link href="/privacy" className="text-primary hover:underline">
              Kebijakan Privasi
            </Link>{" "}
            kami.
          </p>
        </CardContent>
        <CardFooter className="flex justify-center">
          <p className="text-sm text-muted-foreground">
            Sudah punya akun?{" "}
            <Link
              href="/login"
              className="text-primary hover:underline font-medium"
            >
              Masuk sekarang
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}