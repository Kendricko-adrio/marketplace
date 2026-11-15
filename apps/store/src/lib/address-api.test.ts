import { beforeEach, describe, expect, it, vi } from "vitest";

// =========================================================
// lib/address-api — HTTP boundary bersama endpoint alamat
// =========================================================
// Seam publik boundary alamat: header opsional `Idempotency-Key` diteruskan ke
// callback (tanpa normalisasi diam-diam), dan konflik key dipetakan ke 409.
// Persistence (`@/lib/client-addresses`) diganti stub supaya test ini hanya
// mengunci kontrak HTTP, bukan query DB. Validasi UUID milik seam persistence
// dibuktikan di `client-addresses.db.test.ts`.

const book = {
  list: vi.fn(async (...args: unknown[]) => {
    void args;
    return [];
  }),
  create: vi.fn(async (...args: unknown[]) => {
    void args;
    return { id: "address-1" };
  }),
};

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/shipment-regions", () => ({
  createShipmentRegionGateway: () => ({ validateAddress: async () => ({}) }),
}));
vi.mock("@/lib/client-addresses", async (original) => ({
  ...(await original<typeof import("@/lib/client-addresses")>()),
  createClientAddressBook: () => book,
}));

const session = vi.hoisted(() => ({
  access: null as null | { ok: true; session: { user: { id: string } } } | { ok: false; response: Response },
}));
vi.mock("@/lib/route-access", () => ({
  requireOnboardedApiSession: async () =>
    session.access ?? { ok: true, session: { user: { id: "client-1" } } },
}));

import { ClientAddressError } from "@/lib/client-addresses";
import { addressApi } from "./address-api";

const KEY = "b1200000-0000-4000-8000-0000000000aa";

const input = {
  recipientName: "Budi", phone: "081200000001", fullAddress: "Jl. Test No. 1",
  provinceId: "01", cityId: "0101", districtId: "010101", areaId: "01010101",
  postalCode: "01234", isDefault: false,
};

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/addresses", { method: "POST", headers });
}

beforeEach(() => {
  book.create.mockClear();
  book.list.mockClear();
  session.access = null;
});

describe("addressApi create context", () => {
  it("meneruskan Idempotency-Key apa adanya ke callback (tanpa header = object kosong)", async () => {
    const seen: Array<{ requestKey?: string }> = [];
    const response = await addressApi(
      "create",
      async (seamBook, userId, context) => {
        seen.push(context);
        return seamBook.create(userId, input, context);
      },
      request({ "Idempotency-Key": KEY })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { id: "address-1" } });
    expect(seen).toEqual([{ requestKey: KEY }]);
    expect(book.create).toHaveBeenCalledWith("client-1", input, { requestKey: KEY });

    await addressApi("create", async (seamBook, userId, context) => {
      seen.push(context);
      return seamBook.create(userId, input);
    });
    expect(seen[1]).toEqual({});
  });

  it("tidak meneruskan sesi yang ditolak ke callback", async () => {
    session.access = { ok: false, response: Response.json({ success: false }, { status: 401 }) };
    const run = vi.fn(async () => null);
    const response = await addressApi("create", run, request({ "Idempotency-Key": KEY }));
    expect(response.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("addressApi error mapping", () => {
  it("memetakan konflik key create ke 409 dengan pesan pemulihan yang aman", async () => {
    const response = await addressApi("create", async () => {
      throw new ClientAddressError("REQUEST_KEY_CONFLICT", "tujuan berbeda");
    }, request({ "Idempotency-Key": KEY }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      success: false,
      error: "Permintaan alamat berbeda. Periksa Buku Alamat sebelum menambahkan lagi.",
      code: "REQUEST_KEY_CONFLICT",
    });
  });

  it("header tidak valid (levat seam) tetap 400, bukan 409 dan bukan sukses palsu", async () => {
    const response = await addressApi("create", async () => {
      throw new ClientAddressError("INPUT_INVALID", "Idempotency-Key harus berupa UUID");
    }, request({ "Idempotency-Key": "not-a-uuid" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, code: "INPUT_INVALID" });
  });

  it("mempertahankan 404 owned/foreign dan 503 kegagalan tak dikenal", async () => {
    const notFound = await addressApi("update", async () => {
      throw new ClientAddressError("NOT_FOUND", "hidden");
    });
    expect(notFound.status).toBe(404);
    const unavailable = await addressApi("list", async () => {
      throw new Error("driver down");
    });
    expect(unavailable.status).toBe(503);
    // Body 503 tidak membocorkan pesan driver.
    expect(JSON.stringify(await unavailable.json())).not.toContain("driver down");
  });
});
