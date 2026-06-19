"use client";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const callbackURL = searchParams.get("callbackURL") || "/onboarding";

  const [status, setStatus] = useState<"verifying" | "success" | "error">(
    token ? "verifying" : "error"
  );
  const [message, setMessage] = useState(
    token ? "" : "Tautan verifikasi tidak valid atau tidak lengkap."
  );

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    const verify = async () => {
      try {
        const result = await authClient.verifyEmail({
          query: { token, callbackURL },
        });

        if (cancelled) return;

        if (result.error) {
          setStatus("error");
          setMessage(
            result.error.message ||
              "Tautan verifikasi kedaluwarsa atau tidak valid."
          );
        } else {
          setStatus("success");
          setTimeout(() => {
            router.push(callbackURL);
            router.refresh();
          }, 1500);
        }
      } catch (err) {
        console.error("Verify email error:", err);
        if (cancelled) return;
        setStatus("error");
        setMessage("Terjadi kesalahan saat memverifikasi email Anda.");
      }
    };

    verify();
    return () => {
      cancelled = true;
    };
  }, [token, callbackURL, router]);

  return (
    <div className="container mx-auto px-4 py-16 flex justify-center items-center min-h-[calc(100vh-4rem)]">
      <Card className="w-full max-w-md shadow-lg border-muted/40">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">
            {status === "verifying" && "Memverifikasi..."}
            {status === "success" && "Email Terverifikasi!"}
            {status === "error" && "Verifikasi Gagal"}
          </CardTitle>
          {status !== "verifying" && (
            <CardDescription className="text-center">
              {message}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "verifying" && (
            <p className="text-sm text-muted-foreground text-center">
              Mohon tunggu sebentar, kami sedang memverifikasi alamat email
              Anda.
            </p>
          )}

          {status === "success" && (
            <p className="text-sm text-muted-foreground text-center">
              Email Anda berhasil diverifikasi. Anda akan dialihkan untuk
              melengkapi data identitas...
            </p>
          )}

          {status === "error" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">
                Tautan mungkin sudah kedaluwarsa atau pernah digunakan. Anda
                dapat meminta tautan baru.
              </p>
              <Button asChild className="w-full">
                <Link href="/register">Kembali ke pendaftaran</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto px-4 py-16 flex justify-center items-center min-h-[calc(100vh-4rem)]">
          <p className="text-muted-foreground">Memuat...</p>
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}