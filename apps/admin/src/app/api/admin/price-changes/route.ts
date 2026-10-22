import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
import {
  MAX_STAGE_ROWS_HARD_LIMIT,
  PriceChangeError,
  readWorkbookUploadLimits,
  stagePriceChangeBatch,
  stageWorkbookPriceChange,
} from "@/lib/price-changes-administration";
import {
  priceChangeFailureResponse,
  priceChangeSuccessResponse,
  requirePriceActorId,
} from "@/lib/price-changes-http";

// =========================================================
// POST /api/admin/price-changes   [prices:edit + products:view all_branches]
// =========================================================
// Two accepted bodies:
//
//   application/json         1..N manual/bulk rows (source "manual"/"bulk")
//   multipart/form-data      a versioned `.xlsx` workbook (source "xlsx"):
//                            `workbook` file + `requestKey` + optional `reason`
//                            and `parentBatchId` (correction of final failed
//                            rows; per-row linkage comes from `origin_row`).
//
// Both paths are STAGING ONLY: nothing is applied here. The workbook is parsed
// and bounded in memory before any transaction; a fatal container/marker/
// header/bounds problem is a 400 `WORKBOOK_REJECTED` with the machine reason and
// creates no batch, while bad ROWS are staged as final failed rows for the
// report/retry flow. The uploaded bytes are never archived.
//
// `requestKey` (UUID) is the command key: same key + same validated command
// returns the SAME staged batch (200); a different command under a used key is
// 409 REQUEST_KEY_CONFLICT.
export const dynamic = "force-dynamic";

const stageSchema = z.strictObject({
  requestKey: z.uuid(),
  source: z.enum(["manual", "bulk"]).nullish(),
  reason: z.string().max(500).nullish(),
  rows: z
    .array(
      z.strictObject({
        sku: z.string().min(1).max(128),
        action: z.enum(["set_price", "restore_base"]),
        targetUnitPrice: z.string().max(32).nullish(),
        discountPercent: z.string().max(32).nullish(),
      })
    )
    .min(1)
    .max(MAX_STAGE_ROWS_HARD_LIMIT),
});

/** Multipart envelope overhead allowance (boundaries/field headers). */
const MULTIPART_OVERHEAD_BYTES = 512 * 1024;

function formField(form: FormData, name: string): string | null {
  const value = form.get(name);
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new PriceChangeError(400, "INPUT_INVALID", `${name} must be text`);
  }
  return value;
}

async function stageWorkbookUpload(
  request: NextRequest,
  logger: Parameters<typeof priceChangeFailureResponse>[0],
  actorUserId: string
) {
  // Read the configured limits BEFORE buffering anything so an oversized body
  // is rejected from its declared length, not after it was loaded.
  const limits = await readWorkbookUploadLimits();
  const contentLength = Number(request.headers.get("content-length") ?? "");
  if (
    Number.isFinite(contentLength) &&
    contentLength > limits.maxFileBytes + MULTIPART_OVERHEAD_BYTES
  ) {
    throw new PriceChangeError(
      413,
      "COMPRESSED_LIMIT_EXCEEDED",
      "The uploaded workbook exceeds the configured file-size limit"
    );
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    throw new PriceChangeError(
      400,
      "INPUT_INVALID",
      "The multipart body could not be read"
    );
  }
  const file = form.get("workbook");
  if (file === null || typeof file === "string") {
    throw new PriceChangeError(400, "INPUT_INVALID", "workbook file is required");
  }
  if (file.size === 0) {
    throw new PriceChangeError(400, "INPUT_INVALID", "workbook file is empty");
  }
  if (file.size > limits.maxFileBytes) {
    throw new PriceChangeError(
      413,
      "COMPRESSED_LIMIT_EXCEEDED",
      "The uploaded workbook exceeds the configured file-size limit"
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await stageWorkbookPriceChange(
    {
      requestKey: formField(form, "requestKey") ?? "",
      file: bytes,
      reason: formField(form, "reason"),
      parentBatchId: formField(form, "parentBatchId"),
    },
    actorUserId
  );
  logger.info("price_changes.stage.workbook", {
    outcome: "success",
    batchId: result.data.id,
    state: result.data.state,
    rowCount: result.data.rowCount,
    failedCount: result.data.failedCount,
    pendingCount: result.data.pendingCount,
    replayed: result.status === 200,
    bytes: bytes.length,
    actorId: actorUserId,
  });
  return priceChangeSuccessResponse(logger, result.data, result.status);
}

export async function POST(request: NextRequest) {
  const guardResult = await guard("prices", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.startsWith("multipart/form-data")) {
      return await stageWorkbookUpload(
        request,
        logger,
        requirePriceActorId(ctx.user.id)
      );
    }

    const parsed = stageSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      logger.warn("price_changes.stage.invalid_body", { outcome: "denied" });
      return priceChangeFailureResponse(
        logger,
        new PriceChangeError(400, "INPUT_INVALID", "Invalid request body"),
        "price_changes.stage.denied"
      );
    }
    const result = await stagePriceChangeBatch(
      {
        requestKey: parsed.data.requestKey,
        source: parsed.data.source ?? undefined,
        reason: parsed.data.reason ?? null,
        rows: parsed.data.rows,
      },
      requirePriceActorId(ctx.user.id)
    );
    logger.info("price_changes.stage", {
      outcome: "success",
      batchId: result.data.id,
      state: result.data.state,
      rowCount: result.data.rowCount,
      replayed: result.status === 200,
      actorId: ctx.user.id,
      policyVersion: ctx.policy.policyVersion,
    });
    return priceChangeSuccessResponse(logger, result.data, result.status);
  } catch (error) {
    return priceChangeFailureResponse(
      logger,
      error,
      "price_changes.stage.failure"
    );
  }
}
