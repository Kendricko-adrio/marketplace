const ROW_FETCH_LIMIT = 100;
/** Warnings that describe a legitimate no-op, not a row the admin must fix. */
const INFORMATIONAL_WARNINGS = new Set(["MARKDOWN_ABSENT"]);

export type Candidate = {
  variantId: string;
  sku: string;
  productId: string;
  productName: string;
  variantLabel: string | null;
  basePrice: string | null;
  effectiveUnitPrice: string | null;
  storedTarget: string | null;
  markdownActive: boolean;
  priceVersion: number | null;
};

export type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type CandidatePage = { rows: Candidate[]; pagination: Pagination };

export type Preview = {
  inputSku: string;
  action: "set_price" | "restore_base" | "invalid";
  variantLabel: string | null;
  targetUnitPrice: string | null;
  /** Workbook-only raw action/target text (kept for review and the report). */
  inputActionRaw?: string | null;
  inputTargetRaw?: string | null;
  errorReason?: string | null;
  sourceUnitPrice: string | null;
  storedTargetBefore: string | null;
  effectiveUnitPriceBefore: string | null;
  effectiveUnitPriceAfter: string | null;
  markdownActiveBefore: boolean;
  delta: string | null;
  direction: "increase" | "decrease" | "same" | "unknown";
  percent: string | null;
  warnings: string[];
};

export type BatchRow = {
  id: string;
  rowNumber: number;
  inputSku: string;
  variantId: string | null;
  action: "set_price" | "restore_base" | "invalid";
  targetUnitPrice: string | null;
  state: "pending" | "applied" | "unchanged" | "failed";
  resultCode: string | null;
  preview: Preview;
  actual: {
    sourceUnitPrice: string | null;
    previousTargetUnitPrice: string | null;
    previousEffectiveUnitPrice: string | null;
    targetUnitPrice: string | null;
    effectiveUnitPrice: string | null;
    markdownActive: boolean | null;
  };
  appliedRevisionId: string | null;
};

export type Batch = {
  id: string;
  source: "manual" | "bulk" | "xlsx";
  templateVersion: string | null;
  parentBatchId: string | null;
  state: string;
  rowCount: number;
  appliedCount: number;
  unchangedCount: number;
  failedCount: number;
  pendingCount: number;
  haltReason: string | null;
  rows: BatchRow[];
  pagination?: Pagination;
};

export function rupiah(value: string | null): string {
  if (value === null || value === "") return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return `Rp ${parsed.toLocaleString("id-ID")}`;
}

function percentLabel(value: string | null): string {
  if (value === null) return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return `${value}%`;
  return `${Math.abs(parsed).toLocaleString("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

export function impactLabel(preview: Preview): string {
  const delta = Math.abs(Number(preview.delta ?? 0));
  const suffix =
    preview.percent === null ? "" : ` (${percentLabel(preview.percent)})`;
  if (preview.direction === "increase")
    return `Naik ${rupiah(String(delta))}${suffix}`;
  if (preview.direction === "decrease")
    return `Turun ${rupiah(String(delta))}${suffix}`;
  if (preview.direction === "same") return "Tidak berubah";
  return "Tidak diketahui";
}

function warningLabel(warning: string): string {
  switch (warning) {
    case "VARIANT_NOT_FOUND":
      return "SKU tidak ditemukan";
    case "SOURCE_PRICE_INVALID":
      return "Harga sumber tidak valid";
    default:
      return warning;
  }
}

export function rowStatus(row: BatchRow): string {
  const parts: string[] = [];
  if (row.action === "restore_base") {
    parts.push(
      row.preview.storedTargetBefore !== null
        ? "melepas Markdown"
        : "tidak ada Markdown aktif",
    );
  }
  for (const warning of row.preview.warnings) {
    // `MARKDOWN_ABSENT` is already explained by the restore text above.
    if (INFORMATIONAL_WARNINGS.has(warning)) continue;
    parts.push(warningLabel(warning));
  }
  if (row.state === "applied") parts.push("diterapkan");
  else if (row.state === "unchanged") parts.push("tanpa perubahan");
  else if (row.state === "failed")
    parts.push(`gagal (${row.resultCode ?? "UNKNOWN"})`);
  return parts.length === 0 ? "—" : parts.join(" · ");
}

export function haltMessage(reason: string | null): string | null {
  switch (reason) {
    case null:
    case "":
      return null;
    case "POLICY_REVOKED":
      return "Izin edit dicabut; sisa baris ditahan.";
    case "ROW_LIMIT_EXCEEDED":
      return "Batch melebihi batas baris terbaru; sisa baris ditahan.";
    default:
      return `Apply ditahan (${reason}).`;
  }
}

export function statusMessage(batch: Batch): {
  tone: "info" | "success" | "error";
  text: string;
} {
  const { rowCount, appliedCount, unchangedCount, failedCount, pendingCount } =
    batch;
  if (pendingCount > 0) {
    return {
      tone: "info",
      text: `Belum final: ${appliedCount} diterapkan, ${unchangedCount} tanpa perubahan, ${failedCount} gagal, ${pendingCount} pending.`,
    };
  }
  if (failedCount === rowCount)
    return { tone: "error", text: "Semua baris gagal." };
  if (appliedCount === 0 && failedCount === 0 && unchangedCount > 0) {
    return { tone: "info", text: "Tidak ada perubahan harga." };
  }
  if (failedCount > 0) {
    return {
      tone: "error",
      text: `${appliedCount} diterapkan, ${unchangedCount} tanpa perubahan, ${failedCount} gagal.`,
    };
  }
  return { tone: "success", text: `${appliedCount} baris diterapkan.` };
}

export async function reviewDigest(
  rows: readonly BatchRow[],
): Promise<string | null> {
  // Review fingerprint for the audit trail (not an authorization token).
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const bytes = new TextEncoder().encode(
    JSON.stringify(rows.map((row) => row.preview)),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function loadBatchRows(batchId: string): Promise<BatchRow[]> {
  // The batch DTO is paginated; the review and result tables need every row so
  // the aggregates and the per-row audit view are not silently truncated.
  const collected: BatchRow[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const response = await fetch(
      `/api/admin/price-changes/${batchId}?page=${page}&limit=${ROW_FETCH_LIMIT}`,
      { cache: "no-store" },
    );
    const payload = await response.json();
    if (!response.ok || !payload.success) {
      throw new Error(payload.error ?? "Gagal memuat baris batch");
    }
    const dto = payload.data as Batch;
    collected.push(...dto.rows);
    totalPages = dto.pagination?.totalPages ?? 1;
    page += 1;
  } while (page <= totalPages);
  return collected;
}
