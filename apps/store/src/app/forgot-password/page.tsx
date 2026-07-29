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
import { authClient } from "@/lib/auth-client";

const RESEND_COOLDOWN_SECONDS = 60;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Anti-enumeration: we show the same generic success message regardless
  // of whether the email exists or belongs to a Google-only user. Better Auth
  // returns a generic success either way; we mirror that on the client.
  const [submitted, setSubmitted] = useState(false);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await authClient.requestPasswordReset({
        email,
        redirectTo: "/reset-password",
      });
      // Always show the generic success message. Better Auth does not reveal
      // whether the email exists, and we must not either.
      setSubmitted(true);
      startCooldown();
    } catch (err) {
      console.error("Forgot password error:", err);
      // Even on a network error, show the generic message to avoid leaking
      // whether the email is registered (and because the request may still
      // have been received).
      setSubmitted(true);
      startCooldown();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-16 flex justify-center items-center min-h-[calc(100vh-4rem)]">
      <Card className="w-full max-w-md shadow-lg border-muted/40">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">
            Lupa Password
          </CardTitle>
          <CardDescription className="text-center">
            Masukkan email akun Anda dan kami akan mengirim tautan untuk
            mengatur ulang password.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
              {error}
            </div>
          )}

          {submitted ? (
            <div className="space-y-4">
              <div className="bg-muted text-foreground text-sm p-4 rounded-md space-y-2">
                <p>
                  Jika email terdaftar di akun kami, tautan untuk mengatur ulang
                  password telah dikirim ke{" "}
                  <strong>{email}</strong>. Cek kotak masuk dan folder spam
                  Anda.
                </p>
                <p className="text-xs text-muted-foreground">
                  Tautan akan kedaluwarsa dalam 1 jam.
                </p>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleSubmit}
                disabled={loading || cooldown > 0}
              >
                {cooldown > 0
                  ? `Kirim ulang dalam ${cooldown}s`
                  : "Kirim ulang email"}
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
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
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Mengirim..." : "Kirim tautan reset"}
              </Button>
            </form>
          )}
        </CardContent>
        <CardFooter className="flex justify-center">
          <p className="text-sm text-muted-foreground">
            Ingat password Anda?{" "}
            <Link
              href="/login"
              className="text-primary hover:underline font-medium"
            >
              Kembali ke login
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}