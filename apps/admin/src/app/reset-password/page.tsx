"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
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
import {
  changePassword,
  resetPassword,
  signOut,
} from "@/lib/auth-client";

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const force = searchParams.get("force") === "1";

  const isEmailFlow = !!token;
  const isForcedFlow = force && !token;

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!isEmailFlow && !isForcedFlow) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4 py-16">
        <Card className="w-full max-w-md shadow-lg border-muted/40">
          <CardHeader>
            <CardTitle className="text-center">Tautan Tidak Valid</CardTitle>
            <CardDescription className="text-center text-muted-foreground">
              Tautan reset password tidak valid atau telah kedaluwarsa.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <a href="/login">Kembali ke Login</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const validate = (): string | null => {
    if (newPassword.length < 8) return "Password minimal 8 karakter.";
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+/.test(newPassword)) {
      return "Password harus mengandung huruf besar, huruf kecil, dan angka.";
    }
    if (newPassword !== confirmPassword) {
      return "Konfirmasi password tidak cocok.";
    }
    if (isForcedFlow && !currentPassword) {
      return "Password saat ini wajib diisi.";
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }

    setLoading(true);
    try {
      if (isEmailFlow) {
        // Flow B: email link — unauthenticated, identity proven by token
        const result = await resetPassword({
          newPassword,
          token,
        });
        if (result.error) {
          setError(
            result.error.message ||
              "Tautan reset tidak valid atau telah kedaluwarsa."
          );
          return;
        }
      } else {
        // Flow A: forced reset — authenticated, must provide current password
        const result = await changePassword({
          newPassword,
          currentPassword,
          revokeOtherSessions: true,
        });
        if (result.error) {
          setError(
            result.error.message || "Gagal mengganti password. Periksa password saat ini."
          );
          return;
        }
        // Clear the mustResetPassword flag + edge cookie
        document.cookie = "admin.must_reset=; path=/; max-age=0";
        try {
          await fetch("/api/admin/clear-must-reset", { method: "POST" });
        } catch {
          // non-fatal — the flag will be re-checked on next login
        }
      }
      setSuccess(true);
      setTimeout(() => {
        if (isForcedFlow) {
          router.push("/admin");
          router.refresh();
        } else {
          router.push("/login");
          router.refresh();
        }
      }, 1500);
    } catch (err) {
      console.error("Reset password error:", err);
      setError("Terjadi kesalahan. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-16">
      <Card className="w-full max-w-md shadow-lg border-muted/40">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">
            {success ? "Password Diperbarui" : "Reset Password"}
          </CardTitle>
          <CardDescription className="text-center text-muted-foreground">
            {isForcedFlow
              ? "Anda wajib mengganti kata sandi sebelum dapat melanjutkan."
              : "Masukkan kata sandi baru untuk akun Anda."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {success ? (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-2 py-4">
                <CheckCircle2 className="h-12 w-12 text-green-500" />
                <p className="text-sm text-foreground text-center">
                  Password berhasil diperbarui. Anda akan dialihkan...
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {isForcedFlow && (
                <div className="space-y-2">
                  <Label htmlFor="current">
                    Password Saat Ini
                  </Label>
                  <Input
                    id="current"
                    type="password"
                    placeholder="••••••••"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="new">
                  Password Baru
                </Label>
                <Input
                  id="new"
                  type="password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  disabled={loading}
                  minLength={8}
                />
                <p className="text-xs text-muted-foreground">
                  Minimal 8 karakter, mengandung huruf besar, huruf kecil, dan angka.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">
                  Konfirmasi Password Baru
                </Label>
                <Input
                  id="confirm"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={loading}
                  minLength={8}
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={loading}
              >
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {isForcedFlow ? "Ganti Password" : "Reset Password"}
              </Button>
              {isForcedFlow && (
                <button
                  type="button"
                  onClick={async () => {
                    // Clear the must-reset edge cookie first so it doesn't
                    // leak into the next login session.
                    document.cookie = "admin.must_reset=; path=/; max-age=0";
                    // Navigate inside onSuccess (idiomatic Better Auth) with a
                    // hard navigation so the Router Cache can't replay a
                    // stale /admin redirect and the reactive useSession state
                    // race is avoided.
                    await signOut({
                      fetchOptions: {
                        onSuccess: () => {
                          window.location.href = "/login";
                        },
                      },
                    });
                  }}
                  className="block w-full text-center text-xs text-muted-foreground hover:text-foreground"
                >
                  Keluar dan login sebagai user lain
                </button>
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  );
}