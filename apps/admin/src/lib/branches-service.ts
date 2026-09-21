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
        updatedAt: new Date(),
      })
      .where(eq(branches.id, id));

    await writeAuditEvent(tx, {
      actorId: ctx.actorId,
      action: "UPDATE_BRANCH",
      entityType: "branch",
      entityId: id,
      changes: {
        name: { from: existing.name, to: data.name },
        status: { from: existing.status, to: data.status },
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