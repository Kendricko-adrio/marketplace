"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface CopyFeedback {
  message: string;
  ok: boolean;
}

const COPY_FAILED_MESSAGE = "Gagal menyalin. Silakan salin secara manual.";

/**
 * State kecil untuk tombol salin (ID/resi/kode): satu pesan sukses atau gagal
 * yang diumumkan lewat live region, lalu hilang sendiri. Tidak menampilkan
 * sukses palsu ketika clipboard menolak.
 */
export function useCopyFeedback() {
  const [feedback, setFeedback] = useState<CopyFeedback | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const copy = useCallback(async (value: string, successMessage: string) => {
    let ok = true;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      ok = false;
    }
    setFeedback({
      message: ok ? successMessage : COPY_FAILED_MESSAGE,
      ok,
    });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFeedback(null), 3000);
  }, []);

  return { feedback, copy };
}
