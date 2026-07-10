"use client";
import { useState } from "react";
import { Loader2, CheckCircle2, Mail } from "lucide-react";
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
import { requestPasswordReset } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await requestPasswordReset({
        email,
        redirectTo: "/reset-password",
      });
      if (result.error) {
        // Better Auth may return an error for non-existent emails; we still
        // show a generic success message to avoid user enumeration.
        // Only surface real transport/config errors.
        const code = (result.error as { code?: string }).code;
        if (code && code !== "USER_NOT_FOUND") {
          setError("Terjadi kesalahan. Silakan coba lagi nanti.");
          return;
        }
      }
      setSent(true);
    } catch (err) {
      console.error("Forgot password error:", err);
      setError("Terjadi kesalahan. Silakan coba lagi nanti.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-16">
      <Card className="w-full max-w-md shadow-lg border-muted/40">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">
            Lupa Password
          </CardTitle>
          <CardDescription className="text-center text-muted-foreground">
            {sent
              ? "Tautan reset telah dikirim."
              : "Masukkan email akun admin Anda. Kami akan mengirim tautan untuk mereset password."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
              {error}
            </div>
          )}

          {sent ? (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-2 py-4">
                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                  <Mail className="h-6 w-6 text-muted-foreground" />
                </div>
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <p className="text-sm text-foreground text-center">
                  Jika email <strong>{email}</strong> terdaftar sebagai akun
                  admin, tautan reset password telah dikirim. Periksa kotak
                  masuk Anda (termasuk folder spam).
                </p>
                <p className="text-xs text-muted-foreground text-center">
                  Tautan berlaku selama 1 jam.
                </p>
              </div>
              <Button asChild variant="outline" className="w-full">
                <Link href="/login">Kembali ke Login</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@store.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Kirim Tautan Reset
              </Button>
              <div className="text-center">
                <Link
                  href="/login"
                  className="text-sm text-primary hover:underline underline-offset-4"
                >
                  Kembali ke Login
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}