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
import { authClient } from "@/lib/auth-client";

// Mirrors the sign-up rule in lib/auth.ts. Kept in sync manually because the
// regex lives server-side; client-side validation is for UX only.
const PASSWORD_COMPLEXITY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const tokenError = searchParams.get("error");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const hasValidToken = !!token && tokenError !== "INVALID_TOKEN";

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Client-side validation (UX only; server enforces the same rule).
    if (newPassword.length < 8) {
      setError("Password minimal 8 karakter.");
      return;
    }
    if (!PASSWORD_COMPLEXITY_REGEX.test(newPassword)) {
      setError(
        "Password harus mengandung huruf besar, huruf kecil, dan angka."
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Konfirmasi password tidak cocok.");
      return;
    }

    setLoading(true);

    try {
      const result = await authClient.resetPassword({
        newPassword,
        token: token ?? "",
      });

      if (result.error) {
        setError(
          result.error.message ||
            "Tautan reset tidak valid atau sudah kedaluwarsa."
        );
        setLoading(false);
        return;
      }

      setSuccess(true);
      // Hard navigation bypasses the Next.js Router Cache so a stale cached
      // redirect cannot replay. Mirrors the login page pattern.
      setTimeout(() => {
        router.replace("/login?reset=success");
      }, 1200);
    } catch (err) {
      console.error("Reset password error:", err);
      setError("Terjadi kesalahan. Silakan coba lagi.");
      setLoading(false);
    }
  };

  // Invalid / missing token → show error state with resend option.
  if (!hasValidToken) {
    return (
      <div className="container mx-auto px-4 py-16 flex justify-center items-center min-h-[calc(100vh-4rem)]">
        <Card className="w-full max-w-md shadow-lg border-muted/40">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold text-center">
              Tautan Tidak Valid
            </CardTitle>
            <CardDescription className="text-center">
              Tautan reset password tidak valid atau sudah kedaluwarsa.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              Tautan mungkin sudah pernah digunakan atau telah kedaluwarsa
              (berlaku 1 jam). Anda dapat meminta tautan baru.
            </p>
            <Button asChild className="w-full">
              <Link href="/forgot-password">Kirim ulang email reset</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-16 flex justify-center items-center min-h-[calc(100vh-4rem)]">
      <Card className="w-full max-w-md shadow-lg border-muted/40">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">
            {success ? "Password Diperbarui!" : "Atur Ulang Password"}
          </CardTitle>
          <CardDescription className="text-center">
            {success
              ? "Password Anda berhasil diubah. Mengalihkan ke halaman login..."
              : "Masukkan password baru untuk akun Anda."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
              {error}
            </div>
          )}

          {success ? (
            <p className="text-sm text-muted-foreground text-center">
              Anda akan dialihkan ke halaman login. Silakan masuk dengan
              password baru Anda.
            </p>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password" className="mb-1.5 block">
                  Password baru
                </Label>
                <Input
                  id="new-password"
                  type="password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="new-password"
                />
                <p className="text-xs text-muted-foreground">
                  Minimal 8 karakter, mengandung huruf besar, huruf kecil, dan
                  angka.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password" className="mb-1.5 block">
                  Konfirmasi password baru
                </Label>
                <Input
                  id="confirm-password"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="new-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Memproses..." : "Atur ulang password"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto px-4 py-16 flex justify-center items-center min-h-[calc(100vh-4rem)]">
          <p className="text-muted-foreground">Memuat...</p>
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
