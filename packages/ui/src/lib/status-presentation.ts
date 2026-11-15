/**
 * Pemetaan status → tone semantik (satu sumber untuk store dan admin).
 *
 * Modul ini murni presentasi: tanpa query, provider call, auth, atau Next API.
 * Status yang maknanya sama wajib memakai tone yang sama lintas halaman,
 * sedangkan domain eksplisit mencegah tabrakan nilai seperti `active`,
 * `pending`, atau `completed` yang artinya berbeda per domain.
 *
 * Aturan fallback: `null`, `undefined`, string kosong, dan identifier yang
 * tidak dikenal selalu `neutral`. Tidak ada heuristic substring (`includes`),
 * sehingga nilai baru tidak pernah diklaim sukses/gagal secara otomatis.
 *
 * Kontrak dan tabel lengkap: `.scratch/ux-design/plan/semantic-status-colors-spec.md`
 * dan `docs/features/status-colors.md`.
 */

export type StatusTone =
  | "waiting"
  | "progress"
  | "ready"
  | "info"
  | "success"
  | "error"
  | "cancelled"
  | "neutral";

export type StatusDomain =
  | "order"
  | "payment"
  | "product"
  | "branch"
  | "stock-visibility"
  | "onboarding"
  | "email-verification"
  | "email-verification-flow"
  | "admin-user"
  | "role"
  | "offer"
  | "discount-code"
  | "redemption"
  | "markdown"
  | "price-row"
  | "checkout-result"
  | "checkout-attempt"
  | "stock-operation"
  | "sales-operation"
  | "cms-page"
  | "homepage-content"
  | "promo-selection"
  | "delivery-stage"
  | "tracking";

/**
 * Peta domain → nilai → tone. Nilai adalah identifier/label kanonik, bukan
 * potongan string: pencocokan selalu exact.
 */
const DOMAIN_TONES: Record<StatusDomain, Readonly<Record<string, StatusTone>>> = {
  // Lifecycle order. `completed` = order ditutup, bukan bukti barang diterima.
  order: {
    pending_payment: "waiting",
    processing: "progress",
    ready_for_pickup: "ready",
    completed: "success",
    cancelled: "cancelled",
    failed_payment: "error",
  },
  payment: {
    pending: "waiting",
    paid: "success",
    failed: "error",
  },
  product: {
    aktif: "success",
    habis: "progress",
    arsip: "neutral",
  },
  branch: {
    aktif: "success",
    nonaktif: "neutral",
  },
  // View key dari dua kondisi ProductCard, bukan enum DB baru.
  "stock-visibility": {
    unavailable: "progress",
    unconfirmed: "info",
  },
  onboarding: {
    completed: "success",
    pending: "waiting",
  },
  "email-verification": {
    verified: "success",
    unverified: "waiting",
  },
  "email-verification-flow": {
    verifying: "progress",
    success: "success",
    error: "error",
  },
  "admin-user": {
    active: "success",
    reset_required: "progress",
  },
  // Status Role hanya arsip; tipe/Role Name adalah kategori, bukan status.
  role: {
    archived: "neutral",
  },
  offer: {
    draft: "neutral",
    enabled: "success",
    paused: "progress",
    archived: "neutral",
  },
  "discount-code": {
    active: "success",
    inactive: "neutral",
    archived: "neutral",
  },
  redemption: {
    reserved: "waiting",
    consumed: "success",
    released: "neutral",
  },
  markdown: {
    invalid_source: "error",
    active: "success",
    inactive_target: "progress",
    absent: "neutral",
  },
  "price-row": {
    pending: "waiting",
    applied: "success",
    unchanged: "neutral",
    failed: "error",
  },
  // Label customer "Pembayaran Gagal" mengikuti kondisi query existing.
  "checkout-result": {
    success: "success",
    pending: "waiting",
    cancel: "error",
  },
  // `promoted` = attempt dipromosikan, bukan bukti paid/fulfilled.
  "checkout-attempt": {
    preparing: "progress",
    compensating: "progress",
    processing: "progress",
    manual_review: "progress",
    rejected: "error",
    promoted: "neutral",
  },
  "stock-operation": {
    pending: "progress",
    in_flight: "progress",
    reconciling: "progress",
    manual_review: "progress",
    applied: "success",
    committed: "success",
    failed: "error",
  },
  // Khusus SalesOperation; jangan dipakai untuk StockOperation.
  "sales-operation": {
    intent: "progress",
    dispatched_unknown: "progress",
    manual_review: "progress",
    confirmed: "success",
    rejected: "error",
    aborted: "cancelled",
  },
  "cms-page": {
    published: "success",
    draft: "neutral",
  },
  "homepage-content": {
    inactive: "neutral",
  },
  // Hanya badge `Dipakai`; selection/recommendation bukan lifecycle status.
  "promo-selection": {
    applied: "success",
  },
  // 21 output `projectDeliveryStage` (20 opsi filter + "Order tidak aktif").
  // Mapping per label karena kontrak existing hanya mengekspor label.
  "delivery-stage": {
    "Menunggu pembayaran": "waiting",
    "Verifikasi pembayaran": "progress",
    "Verifikasi tertunda": "progress",
    "Siapkan barang": "progress",
    "Barang siap": "ready",
    "Menunggu penjemputan": "waiting",
    "Diserahkan ke kurir": "info",
    "Dibawa kurir": "info",
    "Dalam pengiriman": "info",
    "Barang diterima": "success",
    "Selesai manual": "neutral",
    "Menunggu hasil booking": "progress",
    "Booking belum pasti": "progress",
    "Stok tidak tersedia": "progress",
    "Barang rusak": "error",
    "Batas layanan terlampaui": "error",
    "Pengiriman tertahan": "progress",
    "Barang dikembalikan": "cancelled",
    "Pengiriman dibatalkan": "cancelled",
    "Kendala pengiriman": "error",
    "Order tidak aktif": "neutral",
  },
  // Normalized provider status. `ON_THE_WAY_PICKUP` hanya alias presentasi.
  tracking: {
    WAITING: "waiting",
    CONFIRMED_BY_COURIER: "info",
    ON_THE_WAY_PICK_UP: "info",
    ON_THE_WAY_PICKUP: "info",
    PICKED_UP: "info",
    ON_DELIVERY: "info",
    DELIVERED: "success",
    ON_HOLD: "progress",
    RETURNED: "cancelled",
    CANCELED: "cancelled",
    SHIPMENT_ISSUE: "error",
  },
};

/**
 * Tone untuk satu nilai status pada domain tertentu.
 *
 * Nilai asing/kosong tidak otomatis error atau success — selalu `neutral`
 * sehingga UI memakai label fallback eksplisitnya sendiri.
 */
export function getStatusTone(
  domain: StatusDomain,
  value: string | null | undefined
): StatusTone {
  if (typeof value !== "string") return "neutral";
  const key = value.trim();
  if (key === "") return "neutral";
  const table = DOMAIN_TONES[domain];
  if (!table) return "neutral";
  return table[key] ?? "neutral";
}

/** DTO hitungan batch harga/import yang sudah ada (tidak dihitung ulang di UI). */
export interface PriceBatchOutcome {
  rowCount: number;
  pendingCount: number;
  appliedCount: number;
  unchangedCount: number;
  failedCount: number;
  haltReason: string | null;
}

/**
 * Tone aggregate batch harga/import (§6.4 spec).
 *
 * Urutan prioritas: halt → error; ada pending → progress (walau ada failed,
 * jangan success); semua baris gagal → error; sebagian gagal → progress;
 * ada applied → success; selain itu (unchanged/zero rows) → neutral.
 */
export function getPriceBatchTone(outcome: PriceBatchOutcome): StatusTone {
  const { rowCount, pendingCount, appliedCount, unchangedCount, failedCount } =
    outcome;
  if (outcome.haltReason) return "error";
  if (pendingCount > 0) return "progress";
  if (rowCount > 0 && failedCount === rowCount) return "error";
  if (failedCount > 0) return "progress";
  if (appliedCount > 0) return "success";
  if (unchangedCount > 0) return "neutral";
  return "neutral";
}
