"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Admin route error:", error);
  }, [error]);

  return (
    <div className="container mx-auto flex min-h-[60vh] flex-col items-center justify-center px-4 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </div>
      <h1 className="text-2xl font-bold text-foreground">
        Terjadi kesalahan saat memuat halaman
      </h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Maaf, terjadi gangguan sementara. Silakan coba lagi atau kembali ke
        dashboard.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button type="button" onClick={() => reset()}>
          Coba lagi
        </Button>
        <Button asChild variant="outline">
          <Link href="/admin">Kembali ke Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
