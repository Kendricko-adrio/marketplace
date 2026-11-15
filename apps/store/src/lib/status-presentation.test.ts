/**
 * Kontrak publik mapping status → tone semantik (spec §6, §10.2).
 *
 * Nilai expected di bawah ditulis ULANG sebagai literal dari tabel spec
 * (`.scratch/ux-design/plan/semantic-status-colors-spec.md`), bukan diimpor
 * dari peta implementasi — jadi tabel tidak bisa "lulus" hanya karena
 * implementasi dan test membaca objek yang sama.
 *
 * Seam yang diuji hanya dua fungsi publik: `getStatusTone` dan
 * `getPriceBatchTone`.
 */
import { describe, expect, it } from "vitest";
import {
  getPriceBatchTone,
  getStatusTone,
  type PriceBatchOutcome,
  type StatusDomain,
  type StatusTone,
} from "@marketplace/ui/src/lib/status-presentation";

// ---------------------------------------------------------------------------
// Tabel literal per domain (spec §6.1)
// ---------------------------------------------------------------------------

const DOMAIN_CASES: Array<[StatusDomain, Array<[string, StatusTone]>]> = [
  [
    "order",
    [
      ["pending_payment", "waiting"],
      ["processing", "progress"],
      ["ready_for_pickup", "ready"],
      ["completed", "success"],
      ["cancelled", "cancelled"],
      ["failed_payment", "error"],
    ],
  ],
  [
    "payment",
    [
      ["pending", "waiting"],
      ["paid", "success"],
      ["failed", "error"],
    ],
  ],
  [
    "product",
    [
      ["aktif", "success"],
      ["habis", "progress"],
      ["arsip", "neutral"],
    ],
  ],
  [
    "branch",
    [
      ["aktif", "success"],
      ["nonaktif", "neutral"],
    ],
  ],
  [
    "stock-visibility",
    [
      ["unavailable", "progress"],
      ["unconfirmed", "info"],
    ],
  ],
  [
    "onboarding",
    [
      ["completed", "success"],
      ["pending", "waiting"],
    ],
  ],
  [
    "email-verification",
    [
      ["verified", "success"],
      ["unverified", "waiting"],
    ],
  ],
  [
    "email-verification-flow",
    [
      ["verifying", "progress"],
      ["success", "success"],
      ["error", "error"],
    ],
  ],
  [
    "admin-user",
    [
      ["active", "success"],
      ["reset_required", "progress"],
    ],
  ],
  ["role", [["archived", "neutral"]]],
  [
    "offer",
    [
      ["draft", "neutral"],
      ["enabled", "success"],
      ["paused", "progress"],
      ["archived", "neutral"],
    ],
  ],
  [
    "discount-code",
    [
      ["active", "success"],
      ["inactive", "neutral"],
      ["archived", "neutral"],
    ],
  ],
  [
    "redemption",
    [
      ["reserved", "waiting"],
      ["consumed", "success"],
      ["released", "neutral"],
    ],
  ],
  [
    "markdown",
    [
      ["invalid_source", "error"],
      ["active", "success"],
      ["inactive_target", "progress"],
      ["absent", "neutral"],
    ],
  ],
  [
    "price-row",
    [
      ["pending", "waiting"],
      ["applied", "success"],
      ["unchanged", "neutral"],
      ["failed", "error"],
    ],
  ],
  [
    "checkout-result",
    [
      ["success", "success"],
      ["pending", "waiting"],
      ["cancel", "error"],
    ],
  ],
  [
    "checkout-attempt",
    [
      ["preparing", "progress"],
      ["compensating", "progress"],
      ["processing", "progress"],
      ["manual_review", "progress"],
      ["rejected", "error"],
      ["promoted", "neutral"],
    ],
  ],
  [
    "stock-operation",
    [
      ["pending", "progress"],
      ["in_flight", "progress"],
      ["reconciling", "progress"],
      ["manual_review", "progress"],
      ["applied", "success"],
      ["committed", "success"],
      ["failed", "error"],
    ],
  ],
  [
    "sales-operation",
    [
      ["intent", "progress"],
      ["dispatched_unknown", "progress"],
      ["manual_review", "progress"],
      ["confirmed", "success"],
      ["rejected", "error"],
      ["aborted", "cancelled"],
    ],
  ],
  [
    "cms-page",
    [
      ["published", "success"],
      ["draft", "neutral"],
    ],
  ],
  ["homepage-content", [["inactive", "neutral"]]],
  ["promo-selection", [["applied", "success"]]],
];

/** Delivery stage: seluruh 21 output `projectDeliveryStage` (spec §6.2). */
const DELIVERY_STAGE_CASES: Array<[string, StatusTone]> = [
  ["Menunggu pembayaran", "waiting"],
  ["Verifikasi pembayaran", "progress"],
  ["Verifikasi tertunda", "progress"],
  ["Siapkan barang", "progress"],
  ["Barang siap", "ready"],
  ["Menunggu penjemputan", "waiting"],
  ["Diserahkan ke kurir", "info"],
  ["Dibawa kurir", "info"],
  ["Dalam pengiriman", "info"],
  ["Barang diterima", "success"],
  ["Selesai manual", "neutral"],
  ["Menunggu hasil booking", "progress"],
  ["Booking belum pasti", "progress"],
  ["Stok tidak tersedia", "progress"],
  ["Barang rusak", "error"],
  ["Batas layanan terlampaui", "error"],
  ["Pengiriman tertahan", "progress"],
  ["Barang dikembalikan", "cancelled"],
  ["Pengiriman dibatalkan", "cancelled"],
  ["Kendala pengiriman", "error"],
  ["Order tidak aktif", "neutral"],
];

/** Tracking provider normalized (spec §6.3), termasuk alias presentasi. */
const TRACKING_CASES: Array<[string, StatusTone]> = [
  ["WAITING", "waiting"],
  ["CONFIRMED_BY_COURIER", "info"],
  ["ON_THE_WAY_PICK_UP", "info"],
  ["ON_THE_WAY_PICKUP", "info"],
  ["PICKED_UP", "info"],
  ["ON_DELIVERY", "info"],
  ["DELIVERED", "success"],
  ["ON_HOLD", "progress"],
  ["RETURNED", "cancelled"],
  ["CANCELED", "cancelled"],
  ["SHIPMENT_ISSUE", "error"],
];

const ALL_DOMAINS: StatusDomain[] = [
  ...DOMAIN_CASES.map(([domain]) => domain),
  "delivery-stage",
  "tracking",
];

describe("getStatusTone — tabel domain", () => {
  for (const [domain, cases] of DOMAIN_CASES) {
    it(`${domain} memetakan seluruh nilai sesuai spec`, () => {
      for (const [value, tone] of cases) {
        expect(getStatusTone(domain, value), `${domain}:${value}`).toBe(tone);
      }
    });
  }

  it("memetakan seluruh 21 output delivery stage", () => {
    expect(DELIVERY_STAGE_CASES).toHaveLength(21);
    for (const [label, tone] of DELIVERY_STAGE_CASES) {
      expect(getStatusTone("delivery-stage", label), label).toBe(tone);
    }
  });

  it("memetakan tracking normalized termasuk alias ON_THE_WAY_PICKUP", () => {
    for (const [status, tone] of TRACKING_CASES) {
      expect(getStatusTone("tracking", status), status).toBe(tone);
    }
    // Alias presentasi dan nilai kanonik runtime berbagi tone yang sama.
    expect(getStatusTone("tracking", "ON_THE_WAY_PICK_UP")).toBe(
      getStatusTone("tracking", "ON_THE_WAY_PICKUP")
    );
  });
});

describe("getStatusTone — fallback aman", () => {
  for (const domain of ALL_DOMAINS) {
    it(`${domain}: null/undefined/kosong/asing menjadi neutral`, () => {
      expect(getStatusTone(domain, null)).toBe("neutral");
      expect(getStatusTone(domain, undefined)).toBe("neutral");
      expect(getStatusTone(domain, "")).toBe("neutral");
      expect(getStatusTone(domain, "   ")).toBe("neutral");
      expect(getStatusTone(domain, "SOME_FUTURE_VALUE")).toBe("neutral");
      expect(getStatusTone(domain, "PAID")).toBe("neutral");
      expect(getStatusTone(domain, "completed-ish")).toBe("neutral");
      expect(getStatusTone(domain, "success")).not.toBe("error");
    });
  }

  it("tidak memakai heuristic substring dari nama nilai lain", () => {
    // "completed" adalah success di domain order, tetapi bukan di offer.
    expect(getStatusTone("order", "completed")).toBe("success");
    expect(getStatusTone("offer", "completed")).toBe("neutral");
    // "not_paid" tidak boleh dianggap paid hanya karena memuat "paid".
    expect(getStatusTone("payment", "not_paid")).toBe("neutral");
    expect(getStatusTone("payment", "unpaid")).toBe("neutral");
    // Nilai asing tidak otomatis error karena mirip nama tone error.
    expect(getStatusTone("product", "error")).toBe("neutral");
  });

  it("string yang sama pada domain berbeda tidak tertukar", () => {
    expect(getStatusTone("admin-user", "active")).toBe("success");
    expect(getStatusTone("discount-code", "active")).toBe("success");
    // "paused" hanya bermakna di offer.
    expect(getStatusTone("offer", "paused")).toBe("progress");
    expect(getStatusTone("payment", "paused")).toBe("neutral");
    // Promotion attempt bukan bukti paid/fulfilled.
    expect(getStatusTone("checkout-attempt", "promoted")).toBe("neutral");
    expect(getStatusTone("sales-operation", "confirmed")).toBe("success");
    // "cancel" (hasil checkout) versus "cancelled" (lifecycle).
    expect(getStatusTone("checkout-result", "cancel")).toBe("error");
    expect(getStatusTone("order", "cancelled")).toBe("cancelled");
  });
});

describe("getStatusTone — dimensi dan kepastian", () => {
  it("order completed success, tetapi penutupan/penghentian delivery neutral", () => {
    expect(getStatusTone("order", "completed")).toBe("success");
    expect(getStatusTone("delivery-stage", "Selesai manual")).toBe("neutral");
    expect(getStatusTone("delivery-stage", "Order tidak aktif")).toBe("neutral");
    // Tidak ada label delivery yang diklaim "Barang diterima" selain DELIVERED.
    expect(getStatusTone("delivery-stage", "Barang diterima")).toBe("success");
  });

  it("payment paid tetap success walau stage fulfillment lain", () => {
    expect(getStatusTone("payment", "paid")).toBe("success");
    expect(getStatusTone("delivery-stage", "Booking belum pasti")).toBe("progress");
    expect(getStatusTone("delivery-stage", "Verifikasi tertunda")).toBe(
      "progress"
    );
  });

  it("manual review/unknown tidak pernah diklaim sukses", () => {
    expect(getStatusTone("checkout-attempt", "manual_review")).not.toBe(
      "success"
    );
    expect(getStatusTone("stock-operation", "manual_review")).not.toBe(
      "success"
    );
    expect(getStatusTone("sales-operation", "manual_review")).not.toBe(
      "success"
    );
    expect(getStatusTone("tracking", null)).not.toBe("success");
  });
});

// ---------------------------------------------------------------------------
// Aggregate import/bulk harga (spec §6.4)
// ---------------------------------------------------------------------------

function outcome(overrides: Partial<PriceBatchOutcome> = {}): PriceBatchOutcome {
  return {
    rowCount: 0,
    pendingCount: 0,
    appliedCount: 0,
    unchangedCount: 0,
    failedCount: 0,
    haltReason: null,
    ...overrides,
  };
}

describe("getPriceBatchTone — matriks aggregate", () => {
  it("haltReason menang atas seluruh hitungan", () => {
    expect(
      getPriceBatchTone(
        outcome({
          rowCount: 5,
          appliedCount: 5,
          haltReason: "POLICY_REVOKED",
        })
      )
    ).toBe("error");
    expect(
      getPriceBatchTone(
        outcome({
          rowCount: 5,
          pendingCount: 5,
          haltReason: "ROW_LIMIT_EXCEEDED",
        })
      )
    ).toBe("error");
  });

  it("ada pending → progress, bukan success walau ada failed", () => {
    expect(
      getPriceBatchTone(outcome({ rowCount: 3, pendingCount: 3 }))
    ).toBe("progress");
    expect(
      getPriceBatchTone(
        outcome({ rowCount: 5, pendingCount: 2, failedCount: 3 })
      )
    ).toBe("progress");
    expect(
      getPriceBatchTone(
        outcome({ rowCount: 5, pendingCount: 1, appliedCount: 4 })
      )
    ).toBe("progress");
  });

  it("seluruh baris gagal → error", () => {
    expect(getPriceBatchTone(outcome({ rowCount: 4, failedCount: 4 }))).toBe(
      "error"
    );
  });

  it("sebagian gagal tanpa pending → progress", () => {
    expect(
      getPriceBatchTone(
        outcome({ rowCount: 4, appliedCount: 2, failedCount: 2 })
      )
    ).toBe("progress");
    expect(
      getPriceBatchTone(
        outcome({ rowCount: 3, appliedCount: 2, failedCount: 1, unchangedCount: 0 })
      )
    ).toBe("progress");
  });

  it("applied > 0 tanpa pending/gagal → success, termasuk mixed unchanged", () => {
    expect(getPriceBatchTone(outcome({ rowCount: 3, appliedCount: 3 }))).toBe(
      "success"
    );
    expect(
      getPriceBatchTone(
        outcome({ rowCount: 4, appliedCount: 2, unchangedCount: 2 })
      )
    ).toBe("success");
  });

  it("hanya unchanged atau belum ada hasil → neutral", () => {
    expect(
      getPriceBatchTone(outcome({ rowCount: 2, unchangedCount: 2 }))
    ).toBe("neutral");
    expect(getPriceBatchTone(outcome({ rowCount: 0 }))).toBe("neutral");
    expect(getPriceBatchTone(outcome())).toBe("neutral");
  });
});
