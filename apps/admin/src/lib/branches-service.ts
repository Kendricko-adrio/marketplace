import { eq } from "drizzle-orm";

import { db } from "@/db";
import { branches, users, type branches as branchesSchema } from "@/db";
import type { OperatingHours } from "@marketplace/db/src/schema";
import { writeAuditEvent } from "@/lib/rbac/audit-writer";

// =========================================================
// RBAC: transactional branch mutation service
// =========================================================
// Every branch mutation (create/update/delete) and its `writeAuditEvent` call
// run inside ONE local DB transaction, with the tx executor passed to the
// audit writer so a failed audit write aborts the mutation (and vice versa).
//
// Delete additionally locks the branch row (`SELECT … FOR UPDATE`) and
// re-checks the BRANCH_IN_USE rule INSIDE the transaction: a concurrent
// admin-assignment INSERT that references this branch blocks on the FK check
// against the locked row until this transaction commits (then fails with an
// FK violation) — so the "no admin is home-branched here" decision can never
// race with the delete.
//
// Failures are typed as `BranchServiceError` with stable codes; the routes map
// them to the same responses the inline implementations used to produce.

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type BranchServiceErrorCode = "NOT_FOUND" | "BRANCH_IN_USE";

export class BranchServiceError extends Error {
  readonly code: BranchServiceErrorCode;

  constructor(code: BranchServiceErrorCode, message: string) {
    super(message);
    this.name = "BranchServiceError";
    this.code = code;
  }
}

export interface BranchMutationContext {
  /** Acting admin id (audit actor; nullable for system actors). */
  actorId: string | null;
  /** Current Policy version in force when the event is written. */
  policyVersion: number | null;
}

// =========================================================================
// Shipping-origin complement (ticket 02, spec "Asal dan parcel")
// =========================================================================
// The sender block a delivery shipment departs from: sender phone/address/
// postal code + optional Shipment area id (string, leading zeros preserved).
// It is owned LOCALLY by the Branch admin menu — the Jubelio sync never
// writes these columns — and every supplied value is validated fail-closed.
//
// Wire semantics (parseBranchOrigin):
// - omitted (undefined)  → caller decides: PUT preserves the stored value
//   (backward-compatible clients), POST defaults to NULL;
// - explicit null / ""   → null (clear; empty form fields normalize);
// - supplied value       → trimmed + validated, else { ok:false } (400).

export interface BranchOriginInput {
  shippingPhone: string | null;
  shippingAddress: string | null;
  shippingPostalCode: string | null;
  shippingAreaId: string | null;
}

export type BranchOriginRaw = {
  shippingPhone?: string | null;
  shippingAddress?: string | null;
  shippingPostalCode?: string | null;
  shippingAreaId?: string | null;
};

export type BranchOriginParsed = {
  [K in keyof BranchOriginRaw]: string | null | undefined;
};

export type BranchOriginParseResult =
  | { ok: true; origin: BranchOriginParsed }
  | { ok: false; error: string };

const ORIGIN_FIELDS = [
  "shippingPhone",
  "shippingAddress",
  "shippingPostalCode",
  "shippingAreaId",
] as const;

/**
 * Normalizes + validates the supplied shipping-origin fields. Fails closed as
 * ONE unit: any invalid supplied value rejects the whole mutation before any
 * write happens (route maps { ok:false } to 400).
 */
export function parseBranchOrigin(raw: BranchOriginRaw): BranchOriginParseResult {
  const origin: BranchOriginParsed = {};

  for (const field of ORIGIN_FIELDS) {
    const rawValue = raw[field];
    if (rawValue === undefined) {
      // Omitted on the wire: PUT skips SET under the row lock; POST
      // defaults to null.
      continue;
    }
    if (rawValue === null) {
      origin[field] = null;
      continue;
    }
    const value = rawValue.trim();
    if (value === "") {
      origin[field] = null; // empty form field → null
      continue;
    }
    let error: string | null = null;
    switch (field) {
      case "shippingPhone":
        // Punctuation alone is not a phone number: digits are REQUIRED.
        if (
          value.length < 5 ||
          value.length > 25 ||
          !/^[0-9+()\-\s]+$/.test(value) ||
          !/\d/.test(value)
        ) {
          error = "Telepon pengirim tidak valid (5–25 karakter berisi angka)";
        }
        break;
      case "shippingAddress":
        if (value.length > 500) {
          error = "Alamat asal kirim maksimal 500 karakter";
        }
        break;
      case "shippingPostalCode":
        if (!/^\d{3,10}$/.test(value)) {
          error = "Kode pos asal kirim harus 3–10 digit";
        }
        break;
      case "shippingAreaId":
        if (!/^\d{1,16}$/.test(value)) {
          error = "Area ID Shipment harus 1–16 digit";
        }
        break;
    }
    if (error) return { ok: false, error };
    origin[field] = value;
  }

  return { ok: true, origin };
}

export interface CreateBranchData {
  id: string;
  name: string;
  code: string;
  city: string;
  address: string;
  latitude: string | null;
  longitude: string | null;
  operatingHours: OperatingHours;
  googleMapsUrl: string | null;
  status: "aktif" | "nonaktif";
  // Shipping-origin complement: optional at the SERVICE boundary — an
  // undefined field is omitted from the INSERT (NULL via column default);
  // the route passes concrete values after parseBranchOrigin.
  shippingPhone?: string | null;
  shippingAddress?: string | null;
  shippingPostalCode?: string | null;
  shippingAreaId?: string | null;
}

export async function createBranch(
  data: CreateBranchData,
  ctx: BranchMutationContext
): Promise<typeof branchesSchema.$inferSelect> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(branches)
      .values({
        id: data.id,
        name: data.name,
        code: data.code,
        city: data.city,
        address: data.address,
        latitude: data.latitude,
        longitude: data.longitude,
        operatingHours: data.operatingHours,
        googleMapsUrl: data.googleMapsUrl,
        status: data.status,
        // Undefined keys are omitted by Drizzle → column default (NULL).
        shippingPhone: data.shippingPhone,
        shippingAddress: data.shippingAddress,
        shippingPostalCode: data.shippingPostalCode,
        shippingAreaId: data.shippingAreaId,
      })
      .returning();
    const created = inserted[0];

    await writeAuditEvent(tx, {
      actorId: ctx.actorId,
      action: "CREATE_BRANCH",
      entityType: "branch",
      entityId: data.id,
      changes: { name: { from: null, to: data.name } },
      policyVersion: ctx.policyVersion,
      branchScope: "global",
    });

    return created;
  });
}

export interface UpdateBranchData {
  name: string;
  code: string;
  city: string;
  address: string;
  latitude: string | null;
  longitude: string | null;
  operatingHours: OperatingHours;
  googleMapsUrl: string | null;
  status: "aktif" | "nonaktif";
  // Shipping-origin complement: optional at the SERVICE boundary — an
  // undefined field is skipped by Drizzle's SET mapping (the stored value is
  // preserved under the row lock). The PUT route retains this omission
  // instead of copying a potentially stale pre-check value.
  shippingPhone?: string | null;
  shippingAddress?: string | null;
  shippingPostalCode?: string | null;
  shippingAreaId?: string | null;
}

/**
 * Updates a branch and writes the audit event in one transaction. The branch
 * row is locked and its existence re-checked inside the transaction so the
 * read of the "before" values for the audit diff cannot race with a delete.
 * Returns the pre-update row (the audit diff source of truth).
 */
export async function updateBranch(
  id: string,
  data: UpdateBranchData,
  ctx: BranchMutationContext
): Promise<typeof branchesSchema.$inferSelect> {
  return db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(branches)
      .where(eq(branches.id, id))
      .for("update")
      .limit(1);
    if (locked.length === 0) {
      throw new BranchServiceError("NOT_FOUND", "Branch not found");
    }
    const existing = locked[0];

    await tx
      .update(branches)
      .set({
        name: data.name,
        code: data.code,
        city: data.city,
        address: data.address,
        latitude: data.latitude,
        longitude: data.longitude,
        operatingHours: data.operatingHours,
        googleMapsUrl: data.googleMapsUrl,
        status: data.status,
        shippingPhone: data.shippingPhone,
        shippingAddress: data.shippingAddress,
        shippingPostalCode: data.shippingPostalCode,
        shippingAreaId: data.shippingAreaId,
        updatedAt: new Date(),
      })
      .where(eq(branches.id, id));

    // Complete before/after for the origin complement — but ONLY the fields
    // this mutation actually carried: an omitted field (undefined) is a
    // preserve, never a "changed to null" transition, and must stay out of
    // the audit diff. A rejected origin edit never reaches this write.
    const originChanges: Record<string, unknown> = {};
    if (data.shippingPhone !== undefined) {
      originChanges.shippingPhone = {
        from: existing.shippingPhone ?? null,
        to: data.shippingPhone,
      };
    }
    if (data.shippingAddress !== undefined) {
      originChanges.shippingAddress = {
        from: existing.shippingAddress ?? null,
        to: data.shippingAddress,
      };
    }
    if (data.shippingPostalCode !== undefined) {
      originChanges.shippingPostalCode = {
        from: existing.shippingPostalCode ?? null,
        to: data.shippingPostalCode,
      };
    }
    if (data.shippingAreaId !== undefined) {
      originChanges.shippingAreaId = {
        from: existing.shippingAreaId ?? null,
        to: data.shippingAreaId,
      };
    }

    await writeAuditEvent(tx, {
      actorId: ctx.actorId,
      action: "UPDATE_BRANCH",
      entityType: "branch",
      entityId: id,
      changes: {
        name: { from: existing.name, to: data.name },
        status: { from: existing.status, to: data.status },
        ...originChanges,
      },
      policyVersion: ctx.policyVersion,
      branchScope: "single_branch",
      branchId: id,
    });

    return existing;
  });
}

/**
 * Deletes a branch and writes the audit event in one transaction. The
 * BRANCH_IN_USE re-check runs INSIDE the transaction against the locked branch
 * row (see the module comment for why the lock makes this race-free).
 * Returns the deleted row (the audit changes source of truth).
 */
export async function deleteBranch(
  id: string,
  ctx: BranchMutationContext
): Promise<typeof branchesSchema.$inferSelect> {
  return db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(branches)
      .where(eq(branches.id, id))
      .for("update")
      .limit(1);
    if (locked.length === 0) {
      throw new BranchServiceError("NOT_FOUND", "Branch not found");
    }
    const existing = locked[0];

    const assignedAdmins = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.branchId, id))
      .limit(1);
    if (assignedAdmins.length > 0) {
      throw new BranchServiceError(
        "BRANCH_IN_USE",
        "Branch masih memiliki admin. Pindahkan admin sebelum menghapus branch."
      );
    }

    await tx.delete(branches).where(eq(branches.id, id));

    await writeAuditEvent(tx, {
      actorId: ctx.actorId,
      action: "DELETE_BRANCH",
      entityType: "branch",
      entityId: id,
      changes: { name: { from: existing.name, to: null } },
      policyVersion: ctx.policyVersion,
      // The Branch row is gone; the identity is retained in the changes JSON.
      branchScope: "global",
    });

    return existing;
  });
}