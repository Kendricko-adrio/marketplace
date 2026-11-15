import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { discountAdminRequests, discountOfferRevisions, discountOffers, discountBenefits, discountCodes } from "@/db";
import { maskPromoCode } from "@marketplace/db/src/discount-code";
import { detectOfferUsageDrift, readMaxClientCommitment } from "@/lib/discount-usage-drift";
import {
  beginBoundedTransaction, loadActorPolicyInTransaction, type Executor,
} from "@/lib/admin-command";
import type { LoadedPolicy } from "@/lib/rbac/resolver";
import { writeAuditEvent } from "@/lib/rbac/audit-writer";
import {
  DiscountAdministrationError, readDetailDto, requireDiscountViewer, requireDiscountEditor,
  mapDatabaseError, SAVE_DRAFT_AUDIT_ACTION, PUBLISH_AUDIT_ACTION,
} from "@/lib/discounts-administration";
import { parseDiscountDraftConfiguration, type DiscountDraftConfiguration } from "@marketplace/db/src/discount-draft";
import type { DiscountEditorDetail } from "./discount-editor-contracts";
import { assertDiscountConfigurationAccess, canViewDiscountConfigurationLiterals } from "./discount-configuration-policy";

type Revision = typeof discountOfferRevisions.$inferSelect;
type Receipt = typeof discountAdminRequests.$inferSelect;

export interface DiscountConfigurationSession {
  actor: LoadedPolicy;
  detail: DiscountEditorDetail;
  receipt: Receipt | null;
  liveConfiguration: DiscountDraftConfiguration;
  inspectCommitments(): Promise<{ drift: boolean; maxClientCommitment: number; conflictingProposalIndexes: number[] }>;
  save(configuration: DiscountDraftConfiguration): Promise<DiscountEditorDetail>;
  publish(configuration: DiscountDraftConfiguration, stateAfter: string, policyChanged: boolean): Promise<DiscountEditorDetail>;
  recordReceipt(requestKey: string, fingerprint: string, result: DiscountEditorDetail, action?: "save_configuration" | "publish_configuration"): Promise<void>;
}

/** Baseline transisi dari projection legacy; tidak mengubah kolom live. */
function legacyConfiguration(detail: DiscountEditorDetail | Awaited<ReturnType<typeof readDetailDto>>): DiscountDraftConfiguration {
  if (!detail) throw new Error("Missing discount aggregate");
  const revision = detail.draftRevision ?? detail.liveRevision;
  const benefit = revision?.benefit;
  const parsed = parseDiscountDraftConfiguration({
    draftSchemaVersion: 1, name: revision?.name ?? null, currency: "IDR",
    minSubtotal: revision?.minSubtotal ?? null, startAt: revision?.startAt ?? null, endAt: revision?.endAt ?? null,
    benefit: !benefit ? null : benefit.kind === "fixed_goods"
      ? { kind: benefit.kind, paramsVersion: benefit.paramsVersion, fixedAmount: benefit.fixedAmount }
      : benefit.kind === "shipping"
        ? { kind: benefit.kind, paramsVersion: benefit.paramsVersion, capAmount: benefit.capAmount }
        : { kind: benefit.kind, paramsVersion: benefit.paramsVersion, rate: benefit.rate, capAmount: benefit.capAmount },
    capacity: { quotaCount: detail.quotaCount, budgetAmount: detail.budgetAmount, perClientLimit: detail.perClientLimit },
    codeChanges: { proposedCodes: [], states: [] },
  });
  if (!parsed.success) throw new DiscountAdministrationError(409, "DRAFT_INVALID", "Draft existing tidak sesuai kontrak yang didukung");
  return parsed.configuration;
}

async function readEditorDetail(tx: Executor, offerId: string, includeLiterals: boolean): Promise<DiscountEditorDetail> {
  const detail = await readDetailDto(tx, offerId, includeLiterals);
  if (!detail) throw new DiscountAdministrationError(404, "NOT_FOUND", "Diskon tidak ditemukan");
  const revisions = await tx.select().from(discountOfferRevisions).where(eq(discountOfferRevisions.offerId, offerId));
  const draft = revisions.find((row) => row.publishedAt === null);
  const source = draft ? "draft" : detail.currentRevisionId ? "live" : "empty";
  const parsed = draft?.draftConfiguration === null || draft?.draftConfiguration === undefined
    ? { success: true as const, configuration: legacyConfiguration(detail) }
    : parseDiscountDraftConfiguration(draft.draftConfiguration);
  if (!parsed.success) throw new DiscountAdministrationError(409, "DRAFT_INVALID", "Draft tersimpan tidak sesuai kontrak yang didukung");
  const configuration = includeLiterals ? parsed.configuration : {
    ...parsed.configuration, codeChanges: { proposedCodes: [], states: [] },
  };
  return { ...detail, draftConfiguration: configuration, configurationSource: source };
}

async function lockOffer(tx: Executor, offerId: string): Promise<void> {
  const rows = await tx.select({ id: discountOffers.id }).from(discountOffers)
    .where(eq(discountOffers.id, offerId)).for("update");
  if (!rows.length) throw new DiscountAdministrationError(404, "NOT_FOUND", "Diskon tidak ditemukan");
}

async function saveSnapshot(
  tx: Executor, detail: DiscountEditorDetail, actor: LoadedPolicy,
  actorUserId: string, configuration: DiscountDraftConfiguration,
): Promise<DiscountEditorDetail> {
  const now = new Date();
  const rows = await tx.select().from(discountOfferRevisions).where(eq(discountOfferRevisions.offerId, detail.id));
  const draft: Revision | undefined = rows.find((row) => row.publishedAt === null);
  if (draft) {
    await tx.update(discountOfferRevisions).set({
      draftConfiguration: configuration, draftVersion: draft.draftVersion + 1, updatedAt: now,
    }).where(eq(discountOfferRevisions.id, draft.id));
  } else {
    await tx.insert(discountOfferRevisions).values({
      id: randomUUID(), offerId: detail.id,
      revisionNo: rows.reduce((max, row) => Math.max(max, row.revisionNo), 0) + 1,
      draftConfiguration: configuration, draftVersion: 1,
      actorId: actorUserId, actorIdentity: actorUserId, createdAt: now, updatedAt: now,
    });
  }
  await tx.update(discountOffers).set({ draftVersion: detail.draftVersion + 1, updatedAt: now })
    .where(eq(discountOffers.id, detail.id));
  // Audit tidak menyimpan usulan literal kode maupun literal yang sudah terbit.
  const auditSnapshot = (value: DiscountDraftConfiguration) => ({
    ...value, codeChanges: { proposedCodes: value.codeChanges.proposedCodes.map(maskPromoCode), states: value.codeChanges.states },
  });
  await writeAuditEvent(tx, {
    actorId: actorUserId, actorIdentity: actorUserId, action: SAVE_DRAFT_AUDIT_ACTION,
    entityType: "discount_offer", entityId: detail.id,
    changes: { before: auditSnapshot(detail.draftConfiguration), after: auditSnapshot(configuration), draftVersionAfter: detail.draftVersion + 1 },
    policyVersion: actor.policyVersion, branchScope: "global",
  });
  return readEditorDetail(tx, detail.id, true);
}

async function publishSnapshot(
  tx: Executor, detail: DiscountEditorDetail, actor: LoadedPolicy, actorUserId: string,
  configuration: DiscountDraftConfiguration, stateAfter: string, policyChanged: boolean,
): Promise<DiscountEditorDetail> {
  const draftId = detail.draftRevision?.id;
  const benefit = configuration.benefit;
  if (!draftId || !benefit || configuration.name === null || configuration.minSubtotal === null || configuration.capacity.perClientLimit === null) {
    throw new DiscountAdministrationError(409, "OFFER_NOT_PUBLISHABLE", "Draft belum lengkap");
  }
  const now = new Date();
  // Kolom published lengkap baru dimaterialisasikan di commit publish.
  await tx.insert(discountBenefits).values({
    id: randomUUID(), revisionId: draftId, paramsVersion: 1, createdAt: now,
    kind: benefit.kind, scope: benefit.kind === "shipping" ? "shipping" : "goods",
    fixedAmount: benefit.kind === "fixed_goods" ? benefit.fixedAmount : null,
    rate: benefit.kind === "percentage_goods" ? benefit.rate : null,
    capAmount: benefit.kind === "fixed_goods" ? null : benefit.capAmount,
  }).onConflictDoUpdate({ target: discountBenefits.revisionId, set: {
    kind: benefit.kind, scope: benefit.kind === "shipping" ? "shipping" : "goods", paramsVersion: 1,
    fixedAmount: benefit.kind === "fixed_goods" ? benefit.fixedAmount : null,
    rate: benefit.kind === "percentage_goods" ? benefit.rate : null,
    capAmount: benefit.kind === "fixed_goods" ? null : benefit.capAmount,
  } });
  for (const canonicalCode of configuration.codeChanges.proposedCodes) {
    const inserted = await tx.insert(discountCodes).values({
      id: randomUUID(), offerId: detail.id, activationKind: "manual_only", canonicalCode,
      state: "active", version: 1, publishedAt: now, actorId: actorUserId, actorIdentity: actorUserId, createdAt: now, updatedAt: now,
    }).onConflictDoNothing({ target: discountCodes.canonicalCode }).returning({ id: discountCodes.id });
    if (!inserted.length) throw new DiscountAdministrationError(409, "CODE_CONFLICT", "Kode sudah digunakan. Pilih kode lain.");
  }
  for (const change of configuration.codeChanges.states) {
    const existing = detail.codes.find((code) => code.id === change.codeId);
    if (existing?.state === change.state) continue;
    const updated = await tx.update(discountCodes).set({ state: change.state, version: change.expectedCodeVersion + 1, updatedAt: now })
      .where(and(eq(discountCodes.id, change.codeId), eq(discountCodes.offerId, detail.id), eq(discountCodes.version, change.expectedCodeVersion)))
      .returning({ id: discountCodes.id });
    if (!updated.length) throw new DiscountAdministrationError(409, "STALE_REVISION", "Status kode telah berubah. Muat versi terbaru.");
  }
  await tx.update(discountOfferRevisions).set({
    name: configuration.name, currency: configuration.currency, minSubtotal: configuration.minSubtotal,
    startAt: configuration.startAt ? new Date(configuration.startAt) : null,
    endAt: configuration.endAt ? new Date(configuration.endAt) : null,
    draftConfiguration: configuration, publishedAt: now, updatedAt: now,
  }).where(and(eq(discountOfferRevisions.id, draftId), sql`${discountOfferRevisions.publishedAt} is null`));
  await tx.update(discountOffers).set({
    state: stateAfter, currentRevisionId: draftId,
    quotaCount: configuration.capacity.quotaCount, budgetAmount: configuration.capacity.budgetAmount,
    perClientLimit: configuration.capacity.perClientLimit,
    policyVersion: detail.policyVersion + (policyChanged ? 1 : 0), version: detail.version + 1, updatedAt: now,
  }).where(eq(discountOffers.id, detail.id));
  await writeAuditEvent(tx, {
    actorId: actorUserId, actorIdentity: actorUserId, action: PUBLISH_AUDIT_ACTION,
    entityType: "discount_offer", entityId: detail.id, policyVersion: actor.policyVersion, branchScope: "global",
    changes: {
      fromRevisionId: detail.currentRevisionId, toRevisionId: draftId, fromState: detail.state, toState: stateAfter,
      before: { quotaCount: detail.quotaCount, budgetAmount: detail.budgetAmount, perClientLimit: detail.perClientLimit },
      after: { ...configuration, codeChanges: {
        proposedCodes: configuration.codeChanges.proposedCodes.map(maskPromoCode), states: configuration.codeChanges.states,
      } }, policyVersionAfter: detail.policyVersion + (policyChanged ? 1 : 0),
    },
  });
  return readEditorDetail(tx, detail.id, true);
}

/** Actor → role → request key → Offer; seluruh penulisan dalam satu commit. */
export async function withLockedDiscountConfiguration<T>(
  input: { offerId: string; actorUserId: string; requestKey?: string },
  operation: (session: DiscountConfigurationSession) => Promise<T>,
): Promise<T> {
  try {
    return await beginBoundedTransaction(async (tx) => {
      const actor = requireDiscountViewer(await loadActorPolicyInTransaction(tx, input.actorUserId));
      if (input.requestKey) {
        // Kunci juga request key yang belum mempunyai receipt. Collision hash
        // hanya menserialisasi dua request, tidak mengubah hasil operasi.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.actorUserId}:${input.requestKey}`}, 0))`);
      }
      const receipts = input.requestKey ? await tx.select().from(discountAdminRequests).where(and(
        eq(discountAdminRequests.actorIdentity, input.actorUserId), eq(discountAdminRequests.requestKey, input.requestKey),
      )).limit(1) : [];
      await lockOffer(tx, input.offerId);
      const includeLiterals = canViewDiscountConfigurationLiterals({ actor });
      const detail = await readEditorDetail(tx, input.offerId, includeLiterals);
      const session: DiscountConfigurationSession = {
        actor, detail, receipt: receipts[0] ?? null,
        liveConfiguration: legacyConfiguration({ ...detail, draftRevision: null }),
        inspectCommitments: async () => {
          const drift = await detectOfferUsageDrift(tx, input.offerId);
          const maxClientCommitment = await readMaxClientCommitment(tx, input.offerId);
          const proposals = detail.draftConfiguration.codeChanges.proposedCodes;
          const existing = proposals.length ? await tx.select({ code: discountCodes.canonicalCode }).from(discountCodes)
            .where(inArray(discountCodes.canonicalCode, proposals)) : [];
          const conflicts = new Set(existing.map((row) => row.code));
          return { drift: drift.detected, maxClientCommitment, conflictingProposalIndexes: proposals.flatMap((code, index) => conflicts.has(code) ? [index] : []) };
        },
        save: async (configuration) => {
          await assertDiscountConfigurationAccess(session, "save");
          return saveSnapshot(tx, detail, actor, input.actorUserId, configuration);
        },
        publish: async (configuration, stateAfter, policyChanged) => {
          await assertDiscountConfigurationAccess(session, "publish");
          return publishSnapshot(tx, detail, actor, input.actorUserId, configuration, stateAfter, policyChanged);
        },
        recordReceipt: async (requestKey, fingerprint, result, action = "save_configuration") => {
          requireDiscountEditor(actor);
          await tx.insert(discountAdminRequests).values({
            id: randomUUID(), actorId: input.actorUserId, actorIdentity: input.actorUserId,
            requestKey, fingerprint, action, targetId: result.id, version: result.version,
            // Replay membaca detail canonical terkini seperti create legacy;
            // receipt hanya menyimpan metadata, tanpa snapshot/literal kode.
            resultJson: { offerId: result.id, version: result.version, draftVersion: result.draftVersion, policyVersion: result.policyVersion },
          });
        },
      };
      return operation(session);
    });
  } catch (error) { throw mapDatabaseError(error); }
}

export async function getDiscountEditorDetail(offerId: string, actorUserId: string): Promise<DiscountEditorDetail> {
  return withLockedDiscountConfiguration({ offerId, actorUserId }, async (session) => session.detail);
}
