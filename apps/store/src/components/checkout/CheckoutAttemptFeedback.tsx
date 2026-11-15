"use client";

import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CheckoutAttemptResult } from "@/features/checkout/checkout-attempt";

/** State presentasi pemeriksaan status checkout (bukan field API baru). */
export type CheckoutCheckState =
  | "idle"
  | "checking"
  | "unchanged"
  | "updated"
  | "error";

const CHECK_MESSAGES: Record<Exclude<CheckoutCheckState, "idle">, string> = {
  checking: "Memeriksa status…",
  unchanged: "Status belum berubah. Silakan periksa lagi nanti.",
  updated: "Status checkout diperbarui.",
  error: "Status belum dapat diperiksa. Coba lagi.",
};

/**
 * Inline pre-order checkout status. Keeps the reviewed form on screen; a status
 * lookup or a definitive failure never redirects to a non-existent order.
 *
 * Tone mengikuti kepastian: penolakan definitif memakai destructive, sedangkan
 * preparing/processing/compensating/manual_review adalah info/progress —
 * pemeriksaan read-only tidak boleh tampak seperti kegagalan.
 */
export function CheckoutAttemptFeedback({
  result,
  busy,
  onCheckStatus,
  onReviewAgain,
  checkState = "idle",
}: {
  result: CheckoutAttemptResult;
  busy: boolean;
  onCheckStatus: () => void;
  onReviewAgain: () => void;
  checkState?: CheckoutCheckState;
}) {
  // A successful attempt is navigating away, not an error requiring recovery.
  if (result.state === "promoted") return null;

  const canRetry = result.retryAllowed;
  const rejected = result.state === "rejected";
  const uncertain =
    result.state === "manual_review" ||
    result.state === "processing" ||
    result.state === "compensating" ||
    result.state === "preparing";
  const role = rejected ? "alert" : "status";
  const toneClass = rejected
    ? "border-destructive/40 bg-destructive/5"
    : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50";
  const iconClass = rejected ? "text-destructive" : "text-amber-700 dark:text-amber-200";
  const textClass = rejected ? "" : "text-amber-900 dark:text-amber-100";
  const checkingLookup = checkState === "checking";

  return (
    <div
      role={role}
      aria-live="polite"
      data-testid="checkout-attempt-feedback"
      tabIndex={-1}
      className={`mb-4 rounded-lg border p-4 ${toneClass}`}
    >
      <div className="flex items-start gap-3">
        {busy || checkingLookup ? (
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          <AlertCircle className={`mt-0.5 h-5 w-5 shrink-0 ${iconClass}`} aria-hidden="true" />
        )}
        <div className="min-w-0 space-y-3">
          <p className={`text-sm leading-relaxed ${textClass}`}>{result.message}</p>
          <div className="flex flex-wrap gap-2">
            {canRetry ? (
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
            ) : null}
            {uncertain ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || checkingLookup}
                aria-busy={checkingLookup}
                onClick={onCheckStatus}
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                {checkingLookup ? "Memeriksa status…" : "Periksa status checkout"}
              </Button>
            ) : null}
          </div>
          {checkState !== "idle" && (
            <p
              className={`text-xs font-medium ${
                checkState === "error"
                  ? "text-destructive"
                  : rejected
                    ? "text-foreground"
                    : "text-amber-900 dark:text-amber-100"
              }`}
            >
              {CHECK_MESSAGES[checkState]}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
