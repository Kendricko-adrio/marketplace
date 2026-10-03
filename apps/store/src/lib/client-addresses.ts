/**
 * Ticket 02 — client address book persistence seam (pengiriman-ke-rumah).
 *
 * Public seam, agreed with the failing tests in `client-addresses.db.test.ts`
 * (one tightly coupled persistence component — the region HTTP gateway, the
 * /api/addresses routes and the /account/addresses UI are authored separately):
 *
 *   createClientAddressBook(db, regionGateway) — dependency injection only;
 *   no env reads, no HTTP, no own gateway construction. Callers pass the app
 *   drizzle instance (`@/db`) and the Shipment region gateway.
 *
 *     list(clientId)                       → Promise<ClientAddressView[]>
 *     create(clientId, input)              → Promise<ClientAddressView>
 *     update(clientId, addressId, input)   → Promise<ClientAddressView>
 *     remove(clientId, addressId)          → Promise<void>
 *     setDefault(clientId, addressId)      → Promise<ClientAddressView>
 *
 * Contract:
 * - Input is validated with a strict zod schema before anything else; region
 *   IDs and the postcode stay STRINGS (leading zeros preserved, e.g. "01",
 *   "01234") — never coerced to numbers, never reordered.
 * - The external Shipment region gateway verifies the region chain (area →
 *   postcode relation) server-side BEFORE persistence; a gateway rejection
 *   means zero mutation. The gateway call happens outside the transaction so
 *   provider latency never holds the per-client lock.
 * - Every mutation runs in ONE transaction whose FIRST statement is
 *   `SELECT … FOR UPDATE` on the CLIENT row (never the addresses rows): all
 *   mutations for one client serialize on that lock, so concurrent
 *   create/update/set-default cannot interleave. The prior default is cleared
 *   BEFORE any insert/promote; the partial unique index
 *   `address_default_per_client_unique` is the DB-level backstop for "at most
 *   one default per client".
 * - Ownership is enforced INSIDE the transaction with a client-scoped
 *   predicate; a foreign or unknown address throws `ClientAddressError`
 *   (code "NOT_FOUND") without mutating anything and without disclosing
 *   other clients' rows.
 * - Storage mapping: the full recipient name lives in first_name (last_name
 *   empty); canonical city/district labels reuse the existing city/district
 *   columns; province/area labels and the ID chain go to the new nullable
 *   columns. Legacy rows (region columns NULL, legacy "first last" split)
 *   read back with empty-string region IDs and joined recipient names.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import type { ExtractTablesWithRelations, InferSelectModel } from "drizzle-orm";
import type {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { z } from "zod";
import * as schema from "@marketplace/db/src/schema";

const addresses = schema.addresses;
const clients = schema.clients;

export interface ClientAddressInput {
  recipientName: string;
  phone: string;
  fullAddress: string;
  provinceId: string;
  cityId: string;
  districtId: string;
  areaId: string;
  postalCode: string;
  isDefault: boolean;
}

/** Canonical Shipment region block the gateway returns after verification. */
export interface ClientAddressRegionCanonical {
  provinceId: string;
  province: string;
  cityId: string;
  city: string;
  districtId: string;
  district: string;
  areaId: string;
  area: string;
  postalCode: string;
}

/** The ONLY external boundary of this seam (mocked exactly in the tests). */
export interface ClientRegionGateway {
  validateAddress(input: ClientAddressInput): Promise<ClientAddressRegionCanonical>;
}

export interface ClientAddressView extends ClientAddressRegionCanonical {
  id: string;
  recipientName: string;
  phone: string;
  fullAddress: string;
  isDefault: boolean;
}

export interface ClientAddressBook {
  list(clientId: string): Promise<ClientAddressView[]>;
  create(clientId: string, input: ClientAddressInput): Promise<ClientAddressView>;
  update(
    clientId: string,
    addressId: string,
    input: ClientAddressInput
  ): Promise<ClientAddressView>;
  remove(clientId: string, addressId: string): Promise<void>;
  setDefault(clientId: string, addressId: string): Promise<ClientAddressView>;
}

export type ClientAddressErrorCode =
  | "NOT_FOUND" // foreign or unknown address (also unknown client)
  | "INPUT_INVALID"
  | "REGION_INVALID"; // the region gateway rejected the chain

export class ClientAddressError extends Error {
  readonly code: ClientAddressErrorCode;

  constructor(code: ClientAddressErrorCode, message: string) {
    super(message);
    this.name = "ClientAddressError";
    this.code = code;
  }
}

export type ClientAddressesDb = NodePgDatabase<typeof schema>;

type AddressRow = InferSelectModel<typeof addresses>;
type AddressTx = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

// ---------------------------------------------------------------------------
// Input validation (strict — the API layer may pre-trim, the seam never trusts)
// ---------------------------------------------------------------------------

const shipmentRegionId = z
  .string("Shipment region ID harus teks (leading zeros tetap string)")
  .trim()
  .regex(/^\d{1,16}$/, "Shipment region ID harus berupa string angka");

export const clientAddressInputSchema = z.strictObject({
  recipientName: z
    .string("Nama penerima wajib diisi")
    .trim()
    .min(1, "Nama penerima wajib diisi")
    .max(120, "Nama penerima maksimal 120 karakter"),
  phone: z
    .string("Nomor telepon wajib diisi")
    .trim()
    .regex(/^[0-9+()\-\s]{5,25}$/, "Nomor telepon tidak valid")
    .refine((phone) => /\d/.test(phone), "Nomor telepon harus memuat angka"),
  fullAddress: z
    .string("Alamat lengkap wajib diisi")
    .trim()
    .min(1, "Alamat lengkap wajib diisi")
    .max(500, "Alamat lengkap maksimal 500 karakter"),
  provinceId: shipmentRegionId,
  cityId: shipmentRegionId,
  districtId: shipmentRegionId,
  areaId: shipmentRegionId,
  postalCode: z
    .string("Kode pos wajib diisi")
    .trim()
    .regex(/^\d{3,10}$/, "Kode pos tidak valid"),
  isDefault: z.boolean(),
});

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

/** first_name carries the full recipient name; last_name stays empty. */
function recipientNameOf(row: AddressRow): string {
  return [row.firstName, row.lastName]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" ");
}

/** Legacy rows (region columns NULL) surface empty strings in the view. */
function toView(row: AddressRow): ClientAddressView {
  return {
    id: row.id,
    recipientName: recipientNameOf(row),
    phone: row.phone,
    fullAddress: row.fullAddress,
    provinceId: row.provinceId ?? "",
    province: row.province ?? "",
    cityId: row.cityId ?? "",
    city: row.city,
    districtId: row.districtId ?? "",
    district: row.district,
    areaId: row.areaId ?? "",
    area: row.area ?? "",
    postalCode: row.postalCode,
    isDefault: row.isDefault,
  };
}

function toRowValues(input: ClientAddressInput, canonical: ClientAddressRegionCanonical) {
  // Persist the CANONICAL values (the gateway-verified chain), not the raw
  // input, wherever the canonical block carries them.
  return {
    firstName: input.recipientName,
    lastName: "",
    phone: input.phone,
    fullAddress: input.fullAddress,
    provinceId: canonical.provinceId,
    cityId: canonical.cityId,
    districtId: canonical.districtId,
    areaId: canonical.areaId,
    province: canonical.province,
    area: canonical.area,
    city: canonical.city,
    district: canonical.district,
    postalCode: canonical.postalCode,
  };
}

export function createClientAddressBook(
  db: ClientAddressesDb,
  regionGateway: ClientRegionGateway
): ClientAddressBook {
  // --- input gate (fail-closed before any gateway call or transaction) -----
  function requireValidInput(input: ClientAddressInput): ClientAddressInput {
    const parsed = clientAddressInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ClientAddressError(
        "INPUT_INVALID",
        parsed.error.issues
          .map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`)
          .join("; ")
      );
    }
    return parsed.data;
  }

  // --- external region verification (before persistence, outside the lock) --
  async function requireVerifiedRegion(
    input: ClientAddressInput
  ): Promise<ClientAddressRegionCanonical> {
    try {
      return await regionGateway.validateAddress(input);
    } catch (error) {
      throw new ClientAddressError(
        "REGION_INVALID",
        `region alamat tidak tervalidasi server: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /** Serializes every mutation of one client's book on the CLIENT row lock. */
  async function lockOwner(tx: AddressTx, ownerId: string): Promise<void> {
    const locked = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.id, ownerId))
      .for("update")
      .limit(1);
    if (locked.length === 0) {
      throw new ClientAddressError("NOT_FOUND", `client ${ownerId} tidak ditemukan`);
    }
  }

  /** Owned target check INSIDE the transaction; never discloses foreign rows. */
  async function requireOwnedTarget(
    tx: AddressTx,
    ownerId: string,
    addressId: string
  ): Promise<void> {
    const rows = await tx
      .select({ id: addresses.id })
      .from(addresses)
      .where(and(eq(addresses.id, addressId), eq(addresses.userId, ownerId)))
      .limit(1);
    if (rows.length === 0) {
      throw new ClientAddressError(
        "NOT_FOUND",
        `address ${addressId} milik client ${ownerId} tidak ditemukan`
      );
    }
  }

  /**
   * Cleared BEFORE insert/promote (parent contract). Running the clear first
   * avoids transient double-defaults and partial-unique-index violations; the
   * optional excludingId keeps the promoted target untouched mid-flight.
   */
  async function clearPriorDefaults(
    tx: AddressTx,
    ownerId: string,
    excludingId?: string
  ): Promise<void> {
    await tx
      .update(addresses)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(addresses.userId, ownerId),
          eq(addresses.isDefault, true),
          ...(excludingId ? [ne(addresses.id, excludingId)] : [])
        )
      );
  }

  async function list(ownerId: string): Promise<ClientAddressView[]> {
    const rows = await db
      .select()
      .from(addresses)
      .where(eq(addresses.userId, ownerId))
      .orderBy(desc(addresses.createdAt), desc(addresses.id));
    return rows.map(toView);
  }

  async function create(ownerId: string, input: ClientAddressInput): Promise<ClientAddressView> {
    const validated = requireValidInput(input);
    const canonical = await requireVerifiedRegion(validated);
    return db.transaction(async (tx) => {
      await lockOwner(tx, ownerId);
      if (validated.isDefault) await clearPriorDefaults(tx, ownerId);
      const inserted = await tx
        .insert(addresses)
        .values({
          id: randomUUID(),
          userId: ownerId,
          ...toRowValues(validated, canonical),
          isDefault: validated.isDefault,
        })
        .returning();
      return toView(inserted[0]);
    });
  }

  async function update(
    ownerId: string,
    addressId: string,
    input: ClientAddressInput
  ): Promise<ClientAddressView> {
    const validated = requireValidInput(input);
    const canonical = await requireVerifiedRegion(validated);
    return db.transaction(async (tx) => {
      await lockOwner(tx, ownerId);
      await requireOwnedTarget(tx, ownerId, addressId);
      if (validated.isDefault) await clearPriorDefaults(tx, ownerId, addressId);
      const updated = await tx
        .update(addresses)
        .set({
          ...toRowValues(validated, canonical),
          isDefault: validated.isDefault,
          updatedAt: new Date(),
        })
        .where(and(eq(addresses.id, addressId), eq(addresses.userId, ownerId)))
        .returning();
      if (updated.length === 0) {
        throw new ClientAddressError(
          "NOT_FOUND",
          `address ${addressId} milik client ${ownerId} tidak ditemukan`
        );
      }
      return toView(updated[0]);
    });
  }

  async function remove(ownerId: string, addressId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await lockOwner(tx, ownerId);
      await requireOwnedTarget(tx, ownerId, addressId);
      // The orders.address_id FK is ON DELETE SET NULL: orders keep their own
      // immutable snapshot (ticket 04); the book row simply goes away.
      await tx
        .delete(addresses)
        .where(and(eq(addresses.id, addressId), eq(addresses.userId, ownerId)));
    });
  }

  async function setDefault(ownerId: string, addressId: string): Promise<ClientAddressView> {
    return db.transaction(async (tx) => {
      await lockOwner(tx, ownerId);
      await requireOwnedTarget(tx, ownerId, addressId);
      await clearPriorDefaults(tx, ownerId, addressId);
      const promoted = await tx
        .update(addresses)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(and(eq(addresses.id, addressId), eq(addresses.userId, ownerId)))
        .returning();
      if (promoted.length === 0) {
        throw new ClientAddressError(
          "NOT_FOUND",
          `address ${addressId} milik client ${ownerId} tidak ditemukan`
        );
      }
      return toView(promoted[0]);
    });
  }

  return { list, create, update, remove, setDefault };
}