import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@marketplace/db/src/schema";
import { clients } from "@marketplace/db/src/schema";
import { createClientAddressBook } from "./client-addresses";

// =========================================================
// Ticket 02 (pengiriman-ke-rumah-jubelio) — client address book seam,
// DB-backed. The seam is the pre-agreed public interface (spec Ready +
// implementation tracker 02):
//
//   createClientAddressBook(db, regionGateway) in ./client-addresses with
//     list(clientId), create(clientId, input), update(clientId, addressId, input),
//     remove(clientId, addressId), setDefault(clientId, addressId)
//     input { recipientName, phone, fullAddress, provinceId, cityId,
//             districtId, areaId, postalCode, isDefault }  (IDs: strings,
//             leading zeros preserved, e.g. province "01", postal "01234")
//
// ONLY the external provider boundary is mocked: the Shipment region gateway
// (`validateAddress` returns the canonical region block verified server-side).
// Everything else runs against the REAL PostgreSQL dev database:
// persistence, ownership (client B must be rejected on client A's address),
// and the parallel set-default race ("maximum one default per client" —
// acceptance criterion of ticket 02; must be proven with concurrent DB
// operations, not sequential calls).
//
// Expected values are the fixture literals below — never recomputed from the
// implementation.
//
// RED until the parent implements the seam:
// 1. `./client-addresses` does not exist yet → this file fails to load (red).
// 2. The shared `address` table still misses the Shipment region columns
//    (province/CITY/district/area ids + names). The implementer adds them ONLY
//    in packages/db/src/schema/ and applies them with `npm run db:push`.
//
// Requires PostgreSQL reachable via DATABASE_URL (root .env, seeded dev DB).
// Unreachable DB SKIPS these tests — a skip is NOT a pass.
// The dev database is SHARED: fixture rows use the "client-addresses-dbtest-"
// prefix on the client id/email and are deleted (cascade) in afterAll. Seeded
// rows are never reset.
// =========================================================

const PREFIX = "client-addresses-dbtest-";
const ALICE_ID = `${PREFIX}alice`;
const BOB_ID = `${PREFIX}bob`;

// Independent fixture of the Shipment region hierarchy (ticket contract):
// string IDs incl. leading zeros; postal "01234" belongs to area "01010101".
const FIXTURE_REGION = {
  provinceId: "01",
  province: "Fixture Province",
  cityId: "0101",
  city: "Fixture City",
  districtId: "010101",
  district: "Fixture District",
  areaId: "01010101",
  area: "Fixture Area",
  postalCode: "01234",
} as const;

// A region chain outside the fixture — the gateway (provider stand-in) must
// reject it, so the seam must reject it and persist nothing.
const UNKNOWN_REGION = {
  provinceId: "02",
  cityId: "0299",
  districtId: "029901",
  areaId: "02990199",
  postalCode: "09999",
} as const;

// --- seam shape (derived from the factory; adjust only on interface change) ---
type AddressBook = ReturnType<typeof createClientAddressBook>;
type ClientAddressInput = Parameters<AddressBook["create"]>[1];
type RegionGateway = Parameters<typeof createClientAddressBook>[1];
type RegionGatewayInput = Parameters<RegionGateway["validateAddress"]>[0];
type RegionCanonical = Awaited<ReturnType<RegionGateway["validateAddress"]>>;

/**
 * Stand-in for the external Shipment region provider. It validates the
 * area–postal relation against the fixture hierarchy (an independent literal,
 * NOT anything derived from the seam) and returns the canonical block.
 */
function fixtureRegionGateway() {
  return {
    async validateAddress(
      input: RegionGatewayInput
    ): Promise<RegionCanonical> {
      const verified =
        input.provinceId === FIXTURE_REGION.provinceId &&
        input.cityId === FIXTURE_REGION.cityId &&
        input.districtId === FIXTURE_REGION.districtId &&
        input.areaId === FIXTURE_REGION.areaId &&
        input.postalCode === FIXTURE_REGION.postalCode;
      if (!verified) {
        throw new Error("FixtureShipment: region hierarchy rejected");
      }
      // Literal canonical block — never derived from the input object.
      return {
        provinceId: "01",
        province: "Fixture Province",
        cityId: "0101",
        city: "Fixture City",
        districtId: "010101",
        district: "Fixture District",
        areaId: "01010101",
        area: "Fixture Area",
        postalCode: "01234",
      };
    },
  };
}

function regionInput(input: ClientAddressInput): ClientAddressInput {
  return {
    ...input,
    provinceId: FIXTURE_REGION.provinceId,
    cityId: FIXTURE_REGION.cityId,
    districtId: FIXTURE_REGION.districtId,
    areaId: FIXTURE_REGION.areaId,
    postalCode: FIXTURE_REGION.postalCode,
  };
}

function makeInput(
  recipientName: string,
  phone: string,
  fullAddress: string,
  isDefault = false
): ClientAddressInput {
  return regionInput({ recipientName, phone, fullAddress, isDefault } as ClientAddressInput);
}

const url = process.env.DATABASE_URL;

async function dbReachable(): Promise<boolean> {
  if (!url) return false;
  try {
    const probe = new Pool({ connectionString: url, max: 1 });
    await probe.query("select 1");
    await probe.end();
    return true;
  } catch (error) {
    console.warn(
      `[client-addresses.db] NOT run — PostgreSQL unreachable: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return false;
  }
}

const reachable = await dbReachable();
const pool = url ? new Pool({ connectionString: url, max: 8 }) : null;
// The seam consumes the same drizzle instance the app passes at "@/db".
const db = pool ? drizzle(pool, { schema }) : null;
const book = db ? createClientAddressBook(db, fixtureRegionGateway()) : null;
const dbReady = reachable && !!pool && !!db && !!book;

async function resetFixtureClients(): Promise<void> {
  if (!pool || !db) return;
  // Deterministic fixture clients; deleting a client cascades its addresses.
  await pool.query(`DELETE FROM "client" WHERE id LIKE '${PREFIX}%'`);
  await db.insert(clients).values([
    {
      id: ALICE_ID,
      name: "Alice DB Test",
      email: `${PREFIX}alice@example.test`,
      emailVerified: true,
      onboardingCompleted: true,
    },
    {
      id: BOB_ID,
      name: "Bob DB Test",
      email: `${PREFIX}bob@example.test`,
      emailVerified: true,
      onboardingCompleted: true,
    },
  ]);
}

/** Exactly one default row among the given ids, owned through the seam. */
async function expectExactlyOneDefault(targetIds: string[], owner: string) {
  if (!book) return;
  const rows = await book.list(owner);
  const defaults = rows.filter((row) => row.isDefault === true);
  expect(defaults, "at most ONE default per client after parallel set-defaults").toHaveLength(1);
  expect(
    targetIds.some((target) => target === defaults[0].id),
    "the surviving default must be one of the client's own addresses"
  ).toBe(true);
}

describe("client address book seam (PostgreSQL-backed)", () => {
  it.skipIf(!dbReady)(
    "create persists a owned address; list returns it with the canonical region block incl. leading-zero string IDs",
    async () => {
      if (!book) return;
      await resetFixtureClients();
      const created = await book.create(
        ALICE_ID,
        makeInput("Budi Tes Alamat", "081200000001", "Jl. DB Test No. 1")
      );
      const createdId: string = created.id;
      expect(createdId.length, "create must return the stored address id").toBeGreaterThan(0);
      expect(created).toMatchObject({
        recipientName: "Budi Tes Alamat",
        phone: "081200000001",
        fullAddress: "Jl. DB Test No. 1",
        provinceId: "01",
        province: "Fixture Province",
        cityId: "0101",
        city: "Fixture City",
        districtId: "010101",
        district: "Fixture District",
        areaId: "01010101",
        area: "Fixture Area",
        postalCode: "01234",
        isDefault: false,
      });

      const aliceRows = await book.list(ALICE_ID);
      expect(aliceRows).toHaveLength(1);
      expect(aliceRows[0].id).toBe(createdId);

      // Another owner's book must not contain this address.
      expect(await book.list(BOB_ID)).toHaveLength(0);
    }
  );

  it.skipIf(!dbReady)(
    "at most one default per client: a second default clears the first, setDefault switches it",
    async () => {
      if (!book) return;
      await resetFixtureClients();
      const first = await book.create(
        ALICE_ID,
        makeInput("Budi Tes Alamat", "081200000001", "Jl. DB Test No. 1", true)
      );
      expect(first.isDefault).toBe(true);
      const second = await book.create(
        ALICE_ID,
        makeInput("Sari Tes Alamat", "081200000002", "Jl. DB Test No. 2", true)
      );

      const flagsAfterSecond = (await book.list(ALICE_ID)).map((row) => ({
        id: row.id,
        isDefault: row.isDefault === true,
      }));
      expect(flagsAfterSecond.filter((row) => row.isDefault)).toHaveLength(1);
      expect(flagsAfterSecond.find((row) => row.isDefault)?.id).toBe(second.id);

      const third = await book.create(
        ALICE_ID,
        makeInput("Tuti Tes Alamat", "081200000003", "Jl. DB Test No. 3")
      );
      await book.setDefault(ALICE_ID, third.id);
      const flagsAfterSwitch = (await book.list(ALICE_ID)).map((row) => ({
        id: row.id,
        isDefault: row.isDefault === true,
      }));
      expect(flagsAfterSwitch.filter((row) => row.isDefault)).toHaveLength(1);
      expect(flagsAfterSwitch.find((row) => row.isDefault)?.id).toBe(third.id);
      expect(
        flagsAfterSwitch.find((row) => row.id === first.id)?.isDefault
      ).toBe(false);
    }
  );

  it.skipIf(!dbReady)(
    "update rewrites the editable fields, keeps the address id and the verified canonical region",
    async () => {
      if (!book) return;
      await resetFixtureClients();
      const created = await book.create(
        ALICE_ID,
        makeInput("Budi Tes Alamat", "081200000001", "Jl. DB Test No. 1")
      );
      await book.update(
        ALICE_ID,
        created.id,
        regionInput({
          recipientName: "Budi Diubah",
          phone: "081299999999",
          fullAddress: "Jl. DB Test No. 1B, Patokan Pohon",
          isDefault: false,
        } as ClientAddressInput)
      );
      // The result is asserted through the interface (list), not through the
      // update return value, which the interface may shape freely.
      const rows = await book.list(ALICE_ID);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: created.id,
        recipientName: "Budi Diubah",
        phone: "081299999999",
        fullAddress: "Jl. DB Test No. 1B, Patokan Pohon",
        provinceId: "01",
        province: "Fixture Province",
        areaId: "01010101",
        postalCode: "01234",
        isDefault: false,
      });
    }
  );

  it.skipIf(!dbReady)(
    "another client cannot list, update, set-default or remove someone else's address",
    async () => {
      if (!book) return;
      await resetFixtureClients();
      const owned = await book.create(
        ALICE_ID,
        makeInput("Budi Tes Alamat", "081200000001", "Jl. DB Test No. 1")
      );
      const tampered = {
        ...makeInput("Bob Penembus", "081400000004", "Jl. Bob Take Over"),
        isDefault: true,
      } as ClientAddressInput;

      await expect(book.update(BOB_ID, owned.id, tampered)).rejects.toThrow();
      await expect(book.setDefault(BOB_ID, owned.id)).rejects.toThrow();
      await expect(book.remove(BOB_ID, owned.id)).rejects.toThrow();

      const aliceRows = await book.list(ALICE_ID);
      expect(aliceRows).toHaveLength(1);
      expect(aliceRows[0]).toMatchObject({
        id: owned.id,
        recipientName: "Budi Tes Alamat",
        phone: "081200000001",
        fullAddress: "Jl. DB Test No. 1",
        isDefault: false,
      });
      expect(await book.list(BOB_ID)).toHaveLength(0);
    }
  );

  it.skipIf(!dbReady)(
    "unknown address ids reject instead of touching the book",
    async () => {
      if (!book) return;
      await resetFixtureClients();
      const owned = await book.create(
        ALICE_ID,
        makeInput("Budi Tes Alamat", "081200000001", "Jl. DB Test No. 1")
      );
      const ghostId = `${PREFIX}ghost`;
      await expect(
        book.update(ALICE_ID, ghostId, makeInput("X", "0", "Y"))
      ).rejects.toThrow();
      await expect(book.setDefault(ALICE_ID, ghostId)).rejects.toThrow();
      await expect(book.remove(ALICE_ID, ghostId)).rejects.toThrow();
      const rows = await book.list(ALICE_ID);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(owned.id);
    }
  );

  it.skipIf(!dbReady)("rejects a punctuation-only recipient phone without persisting", async () => {
    if (!book) return;
    await resetFixtureClients();
    await expect(book.create(ALICE_ID, makeInput("Recipient", "+++++", "Street 1"))).rejects.toThrow();
    expect(await book.list(ALICE_ID)).toHaveLength(0);
  });

  it.skipIf(!dbReady)(
    "an unresolvable region rejects and persists nothing",
    async () => {
      if (!book) return;
      await resetFixtureClients();
      const bad: ClientAddressInput = {
        recipientName: "Region Tidak Dikenal",
        phone: "081200000099",
        fullAddress: "Jl. Region Tidak Dikenal No. 9",
        ...UNKNOWN_REGION,
        isDefault: false,
      } as ClientAddressInput;
      await expect(book.create(ALICE_ID, bad)).rejects.toThrow();
      expect(await book.list(ALICE_ID)).toHaveLength(0);
    }
  );

  it.skipIf(!dbReady)(
    "parallel setDefault calls on the real database keep exactly one default",
    async () => {
      if (!book) return;
      await resetFixtureClients();
      const targets: { id: string }[] = [];
      targets.push(
        await book.create(
          ALICE_ID,
          makeInput("Budi Tes Alamat", "081200000001", "Jl. DB Test No. 1")
        )
      );
      targets.push(
        await book.create(
          ALICE_ID,
          makeInput("Sari Tes Alamat", "081200000002", "Jl. DB Test No. 2")
        )
      );
      targets.push(
        await book.create(
          ALICE_ID,
          makeInput("Tuti Tes Alamat", "081200000003", "Jl. DB Test No. 3")
        )
      );
      const targetIds = targets.map((target) => target.id);

      // Wave 1: 9 concurrent set-defaults spread round-robin over 3 addresses.
      await Promise.all(
        Array.from({ length: 9 }, (_, index) =>
          book.setDefault(ALICE_ID, targetIds[index % 3])
        )
      );
      await expectExactlyOneDefault(targetIds, ALICE_ID);

      // Wave 2: 8 concurrent flips between the first two targets.
      await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          book.setDefault(ALICE_ID, targetIds[index % 2])
        )
      );
      await expectExactlyOneDefault(targetIds, ALICE_ID);
    }
  );
});

beforeAll(async () => {
  if (!pool) return;
  // Heal leftovers of an interrupted earlier run (deterministic ids).
  await pool.query(`DELETE FROM "client" WHERE id LIKE '${PREFIX}%'`);
});

afterAll(async () => {
  if (!pool) return;
  await pool.query(`DELETE FROM "client" WHERE id LIKE '${PREFIX}%'`);
  await pool.end();
});