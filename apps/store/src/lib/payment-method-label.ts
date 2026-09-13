/**
 * Human-readable label for a Midtrans `payment_type` value (raw value is
 * persisted verbatim in `orders.paymentMethod`). Unknown values fall back to
 * the raw code upper-cased, so new Midtrans methods still render sensibly.
 */
export function formatPaymentMethodLabel(
  paymentMethod: string | null | undefined
): string {
  if (!paymentMethod) return "—";
  const labels: Record<string, string> = {
    qris: "QRIS",
    other_qris: "QRIS",
    gopay: "GoPay",
    credit_card: "Kartu Kredit/Debit",
    bank_transfer: "Transfer Bank/VA",
    permata_va: "VA Permata",
    bca_va: "VA BCA",
    bni_va: "VA BNI",
    bri_va: "VA BRI",
    cimb_va: "VA CIMB",
    echannel: "Mandiri Bill Payment",
    other_va: "VA Bank Lain",
  };
  return labels[paymentMethod] ?? paymentMethod.toUpperCase();
}