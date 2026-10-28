"use client";

import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

/**
 * Feedback preflight pajak SEBELUM pembayaran (spec PPN §7).
 *
 * Berbeda dari `CheckoutAttemptFeedback`: ini bukan status attempt durable, jadi
 * tidak boleh memakai/membuat `CheckoutAttemptResult` palsu. Form, cart, dan
 * pilihan promo tetap di layar; aksi tunggalnya "Periksa ulang pesanan", dan
 * tombol pembayaran tetap tertutup selama konfigurasi pajak tidak valid.
 *
 * Aksesibilitas: `role="alert"`, dapat difokuskan setelah gagal, status tidak
 * hanya dibedakan warna, dan copy tidak memuat tax id/akun/rate internal.
 */
export function CheckoutTaxFeedback({
  message,
  busy,
  onReviewAgain,
}: {
  message: string;
  busy: boolean;
  onReviewAgain: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    containerRef.current?.focus();
  }, [message]);

  return (
    <div
      ref={containerRef}
      role="alert"
      aria-live="assertive"
      data-testid="checkout-tax-feedback"
      tabIndex={-1}
      className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start gap-3">
        {busy ? (
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          <AlertCircle
            className="mt-0.5 h-5 w-5 shrink-0 text-destructive"
            aria-hidden="true"
          />
        )}
        <div className="min-w-0 space-y-3">
          <p className="text-sm leading-relaxed">{message}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onReviewAgain}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Periksa ulang pesanan
          </Button>
        </div>
      </div>
    </div>
  );
}
