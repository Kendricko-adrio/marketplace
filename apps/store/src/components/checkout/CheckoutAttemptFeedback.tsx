"use client";

import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CheckoutAttemptResult } from "@/features/checkout/checkout-attempt";

/**
 * Inline pre-order checkout status. Keeps the reviewed form on screen; a status
 * lookup or a definitive failure never redirects to a non-existent order.
 */
export function CheckoutAttemptFeedback({
  result, busy, onCheckStatus, onReviewAgain,
}: {
  result: CheckoutAttemptResult;
  busy: boolean;
  onCheckStatus: () => void;
  onReviewAgain: () => void;
}) {
  const canRetry = result.retryAllowed;
  const uncertain = result.state === "manual_review" || result.state === "processing" ||
    result.state === "compensating" || result.state === "preparing";
  const role = uncertain ? "status" : "alert";
  return (
    <div role={role} aria-live="polite" data-testid="checkout-attempt-feedback" tabIndex={-1}
      className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <div className="flex items-start gap-3">
        {busy ? <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin" aria-hidden="true" />
          : <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />}
        <div className="min-w-0 space-y-3">
          <p className="text-sm leading-relaxed">{result.message}</p>
          <div className="flex flex-wrap gap-2">
            {canRetry ? (
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onReviewAgain} className="gap-2">
                <RefreshCw className="h-4 w-4" aria-hidden="true" /> Periksa ulang pesanan
              </Button>
            ) : null}
            {uncertain ? (
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCheckStatus} className="gap-2">
                <RefreshCw className="h-4 w-4" aria-hidden="true" /> Periksa status checkout
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
