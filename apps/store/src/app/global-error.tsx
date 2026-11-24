"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Store global error:", error);
  }, [error]);

  return (
    <html lang="id">
      <body className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-16 text-center text-foreground">
        <h1 className="text-2xl font-bold">
          Terjadi kesalahan pada aplikasi
        </h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Maaf, halaman gagal dimuat. Silakan muat ulang untuk melanjutkan.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Muat ulang
        </button>
      </body>
    </html>
  );
}
