import { describe, expect, it } from "vitest";
import type { JubelioSalesOrderEditSnapshot } from "./jubelio-sales-client";
import {
  channelStatusMarkerForTerminalLocalOrderStatus,
  isChannelTargetRegression,
  mirrorPreReadMismatch,
} from "./jubelio-channel-mirror";
import type { JubelioSalesOrderEditRequest } from "@marketplace/db/src/schema";

// =========================================================
// Ticket #03 STAGE 1 correction slice A: the pre-edit cross-check must be
// NARROW enough to catch every field a full-save edit would rewrite. The
// gateway's strict parse already fail-closes source!=1, missing/zero detail
// ids and unevidenced fee/discount/tax money (zero POST); the mirror's own
// cross-check additionally guards ref_no, item unit and item tax_id — a
// missing or diverging value must fail closed WITHOUT a POST, never surface
// as a harmless provider rejection.
// Pure unit slice: runs without PostgreSQL.
// =========================================================

const ITEM_ID = 43842;
const PRICE = 1000;
const INVOICE_ID = 459450001;
const SO_ID = 683990001;

function verifiedCreatePayload(
  overrides: Partial<JubelioSalesOrderEditRequest["edit"]> = {}
): JubelioSalesOrderEditRequest {
  return {
    type: "create",
    create: {
      contactId: -1,
      customerName: "Pelanggan Umum",
      locationId: 7,
      note: "OKCIR_SO_CREATE:order-1:op-1",
      refNo: overrides.refNo ?? "",
      items: [
        {
          itemId: ITEM_ID,
          quantity: 1,
          price: PRICE,
          discAmount: 0,
          taxAmount: 0,
          unit: overrides.items?.[0]?.unit ?? "Buah",
          taxId: overrides.items?.[0]?.taxId ?? 1,
        },
      ],
    },
  } as unknown as JubelioSalesOrderEditRequest;
}

function matchingSnapshot(
  overrides: Partial<JubelioSalesOrderEditSnapshot> = {}
): JubelioSalesOrderEditSnapshot {
  return {
    salesorderId: SO_ID,
    salesorderNo: "SO-000068399",
    source: 1,
    refNo: "",
    contactId: -1,
    customerName: "Pelanggan Umum",
    locationId: 7,
    note: "OKCIR_SO_CREATE:order-1:op-1",
    transactionDate: "2026-09-26T17:00:00.000Z",
    isTaxIncluded: false,
    isCanceled: false,
    invoiceId: INVOICE_ID,
    channelStatus: "Belum Bayar",
    subTotal: PRICE,
    totalDisc: 0,
    totalTax: 0,
    grandTotal: PRICE,
    addFee: 0,
    addDisc: 0,
    serviceFee: 0,
    items: [
      {
        salesorderDetailId: 74682,
        itemId: ITEM_ID,
        quantity: 1,
        price: PRICE,
        disc: 0,
        discAmount: 0,
        taxAmount: 0,
        amount: PRICE,
        unit: "Buah",
        taxId: 1,
        locationId: 7,
      },
    ],
    ...overrides,
  };
}

function confirmedCreate(payload: JubelioSalesOrderEditRequest) {
  // Minimal cast: mirrorPreReadMismatch reads only status + payload.create.
  return {
    status: "confirmed",
    payload,
  } as unknown as Parameters<typeof mirrorPreReadMismatch>[0]["create"];
}

describe("mirrorPreReadMismatch (narrow full-save cross-check, pure unit)", () => {
  it("accepts a pre-read that matches the verified ledger on every allowlist field", () => {
    expect(
      mirrorPreReadMismatch({
        snapshot: matchingSnapshot(),
        create: confirmedCreate(verifiedCreatePayload()),
        verifiedInvoiceId: INVOICE_ID,
      })
    ).toBeNull();
  });

  it("fail-closes on a diverging ref_no (a full-save would silently rewrite it)", () => {
    expect(
      mirrorPreReadMismatch({
        snapshot: matchingSnapshot({ refNo: " drifted " }),
        create: confirmedCreate(verifiedCreatePayload()),
        verifiedInvoiceId: INVOICE_ID,
      })
    ).toBe("PRE_READ_REF_MISMATCH");
  });

  it("fail-closes when ref_no is missing remotely while the request carried one", () => {
    expect(
      mirrorPreReadMismatch({
        snapshot: matchingSnapshot({ refNo: "" }),
        create: confirmedCreate(verifiedCreatePayload({ refNo: "OKCIR-1" })),
        verifiedInvoiceId: INVOICE_ID,
      })
    ).toBe("PRE_READ_REF_MISMATCH");
  });

  it("fail-closes on a diverging item unit (a full-save would rewrite it)", () => {
    const snapshot = matchingSnapshot();
    snapshot.items[0].unit = "Pcs";
    expect(
      mirrorPreReadMismatch({
        snapshot,
        create: confirmedCreate(verifiedCreatePayload()),
        verifiedInvoiceId: INVOICE_ID,
      })
    ).toBe("PRE_READ_ITEM_MISMATCH");
  });

  it("fail-closes on a diverging item tax id (a full-save would rewrite it)", () => {
    const snapshot = matchingSnapshot();
    snapshot.items[0].taxId = 2;
    expect(
      mirrorPreReadMismatch({
        snapshot,
        create: confirmedCreate(verifiedCreatePayload()),
        verifiedInvoiceId: INVOICE_ID,
      })
    ).toBe("PRE_READ_ITEM_MISMATCH");
  });

  it("still fail-closes on money, invoice-link, note, identity, cancel and line-count divergence", () => {
    const base = {
      create: confirmedCreate(verifiedCreatePayload()),
      verifiedInvoiceId: INVOICE_ID,
    };
    expect(
      mirrorPreReadMismatch({
        snapshot: matchingSnapshot({ subTotal: 999, grandTotal: 999 }),
        ...base,
      })
    ).toBe("PRE_READ_MONEY_MISMATCH");
    expect(
      mirrorPreReadMismatch({
        snapshot: matchingSnapshot({ invoiceId: 42 }),
        ...base,
      })
    ).toBe("PRE_READ_INVOICE_LINK_MISMATCH");
    expect(
      mirrorPreReadMismatch({
        snapshot: matchingSnapshot({ note: "other" }),
        ...base,
      })
    ).toBe("PRE_READ_NOTE_MISMATCH");
    expect(
      mirrorPreReadMismatch({
        snapshot: matchingSnapshot({ contactId: 5 }),
        ...base,
      })
    ).toBe("PRE_READ_CONTACT_OR_LOCATION_MISMATCH");
    expect(
      mirrorPreReadMismatch({
        snapshot: matchingSnapshot({ isCanceled: true }),
        ...base,
      })
    ).toBe("PRE_READ_SO_CANCELED");
    const fewer = matchingSnapshot();
    fewer.items = [];
    expect(mirrorPreReadMismatch({ snapshot: fewer, ...base })).toBe(
      "PRE_READ_ITEM_LINE_COUNT_MISMATCH"
    );
  });
});
describe("mirrorPreReadMismatch money tolerance (review correction 1)", () => {
  const base = {
    create: confirmedCreate(verifiedCreatePayload()),
    verifiedInvoiceId: INVOICE_ID,
  };

  it("accepts serialization money noise (1000.0000000001) on item lines and header, matching the gateway's safe epsilon", () => {
    const noisy = matchingSnapshot();
    noisy.items[0].amount = 1000.0000000001;
    noisy.subTotal = 1000.0000000001;
    noisy.grandTotal = 1000.0000000001;
    expect(mirrorPreReadMismatch({ snapshot: noisy, ...base })).toBeNull();
  });

  it("still fail-closes on MATERIAL money changes on item lines (1001)", () => {
    const material = matchingSnapshot();
    material.items[0].amount = 1001;
    expect(
      mirrorPreReadMismatch({ snapshot: material, ...base })
    ).toBe("PRE_READ_ITEM_MISMATCH");
  });

  it("still fail-closes on MATERIAL header money changes (1001)", () => {
    expect(
      mirrorPreReadMismatch({
        snapshot: matchingSnapshot({ subTotal: 1001, grandTotal: 1001 }),
        ...base,
      })
    ).toBe("PRE_READ_MONEY_MISMATCH");
    expect(
      mirrorPreReadMismatch({
        snapshot: matchingSnapshot({ grandTotal: 1001 }),
        ...base,
      })
    ).toBe("PRE_READ_MONEY_MISMATCH");
  });
});

// =========================================================
// Ticket #06 — the FINAL-STATE mapping contract (pure unit, no PostgreSQL):
// a committed local `completed` order maps to the `Selesai` Status Channel
// marker, and a committed local `cancelled` order maps to `Dibatalkan` as a
// FUTURE-FACING MAPPING ONLY (no runtime code path transitions a local order
// to `cancelled` today, so nothing may dispatch that marker in this ticket).
// Also the monotonic-progression guard: an already-confirmed later forward
// stage is never overwritten by an earlier target (no backward marker).
// Expected values come from the approved spec table
// (.scratch/jubelio-pickup-status/spec-draft.md), not from the code.
// =========================================================
describe("channelStatusMarkerForTerminalLocalOrderStatus (ticket #06 mapping contract, pure unit)", () => {
  it("maps a committed `completed` order (which is only reachable after pickup) to `Selesai`", () => {
    expect(channelStatusMarkerForTerminalLocalOrderStatus("completed")).toBe(
      "Selesai"
    );
  });

  it("maps a committed `cancelled` order to `Dibatalkan` as a future-facing contract ONLY", () => {
    // Mapping contract from the approved spec table; no runtime writer for
    // `cancelled` exists, so this mapping must never reach a dispatch path
    // in this ticket (asserted at the reconcile seam in the DB tests).
    expect(channelStatusMarkerForTerminalLocalOrderStatus("cancelled")).toBe(
      "Dibatalkan"
    );
  });

  it("maps no other local order status (Gagal Bayar stays ticket #05; active stages are not final states)", () => {
    expect(
      channelStatusMarkerForTerminalLocalOrderStatus("failed_payment")
    ).toBeNull();
    expect(
      channelStatusMarkerForTerminalLocalOrderStatus("ready_for_pickup")
    ).toBeNull();
    expect(channelStatusMarkerForTerminalLocalOrderStatus("processing")).toBe(
      null
    );
    expect(
      channelStatusMarkerForTerminalLocalOrderStatus("pending_payment")
    ).toBeNull();
  });
});

// =========================================================
// Ticket 01 integration (discounts spec §10.2): the mirror's pre-edit
// cross-check must be VERSION-AWARE. A contract-v2 order carries frozen
// original/net shipping and an expected provider payable (net goods + net
// shipping), so the legacy `grand_total == sub_total` assumption must NEVER
// be applied to it; conversely an unversioned legacy snapshot keeps the
// legacy rule untouched. Expected values below are independent literals from
// the approved contract (goods 150000; pickup payable 150000; delivery
// original/net shipping 30000 → payable 180000), not recomputed by the code
// under test. Unknown/malformed stored versions fail closed — never silently
// fall back to legacy rules.
// =========================================================
const V2_ITEM_ID = 51_001;
const V2_SO_ID = 684_430_001; // never a real remote id
const V2_INVOICE_ID = 459_450_002; // never a real remote id
const V2_GOODS = 150_000;
const V2_ORIGINAL_SHIPPING = 30_000;
const V2_NET_SHIPPING = 30_000;
const V2_PAYABLE = 180_000;
const V2_NOTE = "OKCIR_SO_CREATE:v2-order-1:v2-op-1";

function storedCreatePayload(
  create: Record<string, unknown>
): JubelioSalesOrderEditRequest {
  return { type: "create", create } as unknown as JubelioSalesOrderEditRequest;
}

/** Stored contract-v2 create intent (immutable money snapshot). */
function v2StoredCreate(
  overrides: Record<string, unknown> = {},
  omit: string[] = []
): JubelioSalesOrderEditRequest {
  const create: Record<string, unknown> = {
    contactId: -1,
    customerName: "Pelanggan Umum",
    locationId: 7,
    note: V2_NOTE,
    channelStatus: "Belum Bayar",
    providerContractVersion: 2,
    originalShipmentCost: V2_ORIGINAL_SHIPPING,
    shippingCost: V2_NET_SHIPPING,
    expectedProviderPayable: V2_PAYABLE,
    items: [
      {
        itemId: V2_ITEM_ID,
        quantity: 1,
        price: V2_GOODS,
        discAmount: 0,
        taxAmount: 0,
        unit: "Buah",
        taxId: 1,
      },
    ],
    ...overrides,
  };
  for (const key of omit) delete create[key];
  return storedCreatePayload(create);
}

/** Provider GET snapshot of the same contract-v2 delivery Sales Order. */
function v2Snapshot(
  overrides: Partial<JubelioSalesOrderEditSnapshot> = {}
): JubelioSalesOrderEditSnapshot {
  return {
    salesorderId: V2_SO_ID,
    salesorderNo: "SO-0000684430",
    source: 1,
    refNo: "",
    contactId: -1,
    customerName: "Pelanggan Umum",
    locationId: 7,
    note: V2_NOTE,
    transactionDate: "2026-10-19T15:00:00.000Z",
    isTaxIncluded: false,
    isCanceled: false,
    invoiceId: V2_INVOICE_ID,
    channelStatus: "Belum Bayar",
    subTotal: V2_GOODS,
    totalDisc: 0,
    totalTax: 0,
    grandTotal: V2_PAYABLE,
    addFee: 0,
    addDisc: 0,
    serviceFee: 0,
    originalShipmentCost: V2_ORIGINAL_SHIPPING,
    shippingCost: V2_NET_SHIPPING,
    items: [
      {
        salesorderDetailId: 74_728,
        itemId: V2_ITEM_ID,
        quantity: 1,
        price: V2_GOODS,
        disc: 0,
        discAmount: 0,
        taxAmount: 0,
        amount: V2_GOODS,
        unit: "Buah",
        taxId: 1,
        locationId: 7,
      },
    ],
    ...overrides,
  };
}

describe("mirrorPreReadMismatch contract-v2 envelope (ticket 01, pure unit)", () => {
  it("accepts a matching signed location -1 on the stored request and provider header/items", () => {
    const snapshot = v2Snapshot({ locationId: -1 });
    snapshot.items[0].locationId = -1;
    expect(mirrorPreReadMismatch({
      snapshot,
      create: confirmedCreate(v2StoredCreate({ locationId: -1 })),
      verifiedInvoiceId: V2_INVOICE_ID,
    })).toBeNull();
  });

  it("still rejects a different provider location when the stored location is negative", () => {
    expect(mirrorPreReadMismatch({
      snapshot: v2Snapshot(),
      create: confirmedCreate(v2StoredCreate({ locationId: -1 })),
      verifiedInvoiceId: V2_INVOICE_ID,
    })).toBe("PRE_READ_CONTACT_OR_LOCATION_MISMATCH");
  });

  it("still rejects money drift and invoice-link mismatch at a negative location", () => {
    const snapshot = v2Snapshot({ locationId: -1 });
    snapshot.items[0].locationId = -1;
    const create = confirmedCreate(v2StoredCreate({ locationId: -1 }));
    expect(mirrorPreReadMismatch({
      snapshot: { ...snapshot, grandTotal: V2_PAYABLE - 1 }, create,
      verifiedInvoiceId: V2_INVOICE_ID,
    })).toBe("PRE_READ_MONEY_MISMATCH");
    expect(mirrorPreReadMismatch({
      snapshot: { ...snapshot, invoiceId: null }, create,
      verifiedInvoiceId: V2_INVOICE_ID,
    })).toBe("PRE_READ_INVOICE_LINK_MISMATCH");
  });

  it("accepts a v2 delivery pre-read whose payable is net goods + net shipping, not sub_total", () => {
    expect(
      mirrorPreReadMismatch({
        snapshot: v2Snapshot(),
        create: confirmedCreate(v2StoredCreate()),
        verifiedInvoiceId: V2_INVOICE_ID,
      })
    ).toBeNull();
  });

  it("accepts a v2 pickup pre-read with zero shipping and a payable equal to the net goods", () => {
    expect(
      mirrorPreReadMismatch({
        snapshot: v2Snapshot({
          grandTotal: V2_GOODS,
          originalShipmentCost: 0,
          shippingCost: 0,
        }),
        create: confirmedCreate(
          v2StoredCreate({
            originalShipmentCost: 0,
            shippingCost: 0,
            expectedProviderPayable: V2_GOODS,
          })
        ),
        verifiedInvoiceId: V2_INVOICE_ID,
      })
    ).toBeNull();
  });

  it("fail-closes on a Rp1 provider payable change on a v2 order (no money tolerance)", () => {
    expect(
      mirrorPreReadMismatch({
        snapshot: v2Snapshot({ grandTotal: V2_PAYABLE - 1 }),
        create: confirmedCreate(v2StoredCreate()),
        verifiedInvoiceId: V2_INVOICE_ID,
      })
    ).toBe("PRE_READ_MONEY_MISMATCH");
  });

  it("fail-closes when the v2 pre-read applies the legacy grand_total == sub_total assumption", () => {
    // The legacy rule would demand 150000 while the stored payable is 180000.
    expect(
      mirrorPreReadMismatch({
        snapshot: v2Snapshot({ grandTotal: V2_GOODS }),
        create: confirmedCreate(v2StoredCreate()),
        verifiedInvoiceId: V2_INVOICE_ID,
      })
    ).toBe("PRE_READ_MONEY_MISMATCH");
  });

  it("fail-closes when the GET omits the stored original/net shipping (a missing field is never zero)", () => {
    const snapshot = v2Snapshot();
    delete snapshot.originalShipmentCost;
    delete snapshot.shippingCost;
    expect(
      mirrorPreReadMismatch({
        snapshot,
        create: confirmedCreate(v2StoredCreate()),
        verifiedInvoiceId: V2_INVOICE_ID,
      })
    ).toBe("PRE_READ_MONEY_MISMATCH");
  });

  it("fail-closes when the GET reports a different net shipping than the stored intent", () => {
    expect(
      mirrorPreReadMismatch({
        snapshot: v2Snapshot({ shippingCost: 10_000 }),
        create: confirmedCreate(v2StoredCreate()),
        verifiedInvoiceId: V2_INVOICE_ID,
      })
    ).toBe("PRE_READ_MONEY_MISMATCH");
  });

  it("fail-closes on an unknown stored provider contract version instead of falling back to legacy rules", () => {
    for (const version of [1, 3, null]) {
      expect(
        mirrorPreReadMismatch({
          snapshot: v2Snapshot(),
          create: confirmedCreate(v2StoredCreate({ providerContractVersion: version })),
          verifiedInvoiceId: V2_INVOICE_ID,
        })
      ).toBe("SNAPSHOT_PROVIDER_VERSION_UNSUPPORTED");
    }
  });

  it("fail-closes when a v2 stored intent is missing its frozen shipping/payable money", () => {
    for (const omitted of [
      "originalShipmentCost",
      "shippingCost",
      "expectedProviderPayable",
    ]) {
      expect(
        mirrorPreReadMismatch({
          snapshot: v2Snapshot(),
          create: confirmedCreate(v2StoredCreate({}, [omitted])),
          verifiedInvoiceId: V2_INVOICE_ID,
        })
      ).toBe("SNAPSHOT_PROVIDER_ENVELOPE_INCOMPLETE");
    }
  });

  it("still fail-closes on invoice link, unit and tax divergence for a v2 pre-read (guards not loosened)", () => {
    const base = {
      create: confirmedCreate(v2StoredCreate()),
      verifiedInvoiceId: V2_INVOICE_ID,
    };
    expect(
      mirrorPreReadMismatch({ snapshot: v2Snapshot({ invoiceId: null }), ...base })
    ).toBe("PRE_READ_INVOICE_LINK_MISMATCH");
    const wrongUnit = v2Snapshot();
    wrongUnit.items[0].unit = "Pcs";
    expect(mirrorPreReadMismatch({ snapshot: wrongUnit, ...base })).toBe(
      "PRE_READ_ITEM_MISMATCH"
    );
    const wrongTax = v2Snapshot();
    wrongTax.items[0].taxId = 2;
    expect(mirrorPreReadMismatch({ snapshot: wrongTax, ...base })).toBe(
      "PRE_READ_ITEM_MISMATCH"
    );
  });
});

describe("mirrorPreReadMismatch stored-contract negatives (ticket 01, pure unit)", () => {
  // The stored create intent is decoded by the SHARED pure decoder
  // (jubelio-sales-expected), not by a second ad-hoc money engine. These two
  // shapes are corrupt stored records: they must produce a STATIC, PII-free
  // investigation reason (never a silent legacy read, never a provider call).
  it("rejects a legacy intent that carries contract-v2 shipping money without an explicit version", () => {
    expect(
      mirrorPreReadMismatch({
        snapshot: v2Snapshot(),
        create: confirmedCreate(v2StoredCreate({}, ["providerContractVersion"])),
        verifiedInvoiceId: V2_INVOICE_ID,
      })
    ).toBe("SNAPSHOT_PROVIDER_VERSION_UNSUPPORTED");
  });

  it("rejects a v2 stored intent whose payable does not equal net goods + net shipping", () => {
    expect(
      mirrorPreReadMismatch({
        snapshot: v2Snapshot(),
        create: confirmedCreate(
          v2StoredCreate({ expectedProviderPayable: V2_PAYABLE - 1 })
        ),
        verifiedInvoiceId: V2_INVOICE_ID,
      })
    ).toBe("SNAPSHOT_PROVIDER_ENVELOPE_INCOMPLETE");
  });

  it("keeps the legit v2 pair accepted (the shared decoder is not stricter than the stored record)", () => {
    expect(
      mirrorPreReadMismatch({
        snapshot: v2Snapshot(),
        create: confirmedCreate(v2StoredCreate()),
        verifiedInvoiceId: V2_INVOICE_ID,
      })
    ).toBeNull();
  });
});

describe("isChannelTargetRegression (ticket #06: no backward overwrite of a confirmed forward stage)", () => {
  it("refuses to re-project an EARLIER stage over a confirmed `Selesai` (no backward marker overwrite)", () => {
    expect(isChannelTargetRegression("Selesai", "Siap Proses")).toBe(true);
  });

  it("allows the forward progression Siap Proses → Selesai after the older intent is confirmed", () => {
    expect(isChannelTargetRegression("Siap Proses", "Selesai")).toBe(false);
  });

  it("treats an already-confirmed equal target as a regression (nothing to dispatch)", () => {
    expect(isChannelTargetRegression("Selesai", "Selesai")).toBe(true);
    expect(isChannelTargetRegression("Siap Proses", "Siap Proses")).toBe(true);
  });

  it("never claims an ordering against a target outside the linear sales progression (Gagal Bayar is #05's branch state, not a forward stage)", () => {
    expect(isChannelTargetRegression("Gagal Bayar", "Selesai")).toBe(false);
    expect(isChannelTargetRegression("Gagal Bayar", "Siap Proses")).toBe(false);
    expect(isChannelTargetRegression("Belum Bayar", "Selesai")).toBe(false);
  });
});
