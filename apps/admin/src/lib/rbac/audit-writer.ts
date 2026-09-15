import { randomUUID } from "crypto";

import { db } from "@/db";
import { auditLogs } from "@/db";

// =========================================================
// RBAC: authorization audit writer
// =========================================================
// Immutable audit events for authorization changes, written inside the same
// transaction as the mutation (roles-service). Every event records the actor,
// the target, the full before/after diff, the reason (where mandatory), and
// the Policy version in force when the event was written. Role definitions
// are global objects, so branchScope is "global" for role events.
//
// Drizzle query builders are LAZY: `executor.insert(t).values(v)` only runs
// when the chain is awaited. This writer is therefore async and awaits the
// insert so that (a) the event is actually persisted, and (b) a failed audit
// write aborts the mutation transaction instead of committing silently.

export interface AuditEventInput {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  changes?: unknown;
  /** Policy version in force when the event was written. */
  policyVersion?: number | null;
  branchScope?: "global" | "single_branch" | "dual_branch" | null;
  branchId?: string | null;
  relatedBranchId?: string | null;
  ipAddress?: string | null;
}

/** Any Drizzle executor that can insert rows (the db or a transaction). */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function writeAuditEvent(
  executor: Executor,
  input: AuditEventInput
): Promise<void> {
  await executor.insert(auditLogs).values({
    id: randomUUID(),
    userId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    changes: (input.changes ?? null) as typeof auditLogs.$inferInsert["changes"],
    policyVersion: input.policyVersion ?? null,
    branchScope: input.branchScope ?? null,
    branchId: input.branchId ?? null,
    relatedBranchId: input.relatedBranchId ?? null,
    ipAddress: input.ipAddress ?? null,
  });
}