import type { HomepageProduct } from "@marketplace/ui";

/**
 * Pure logic behind the manual-mode carousel preview inside the homepage
 * section editor. The editor keeps a cache of product cards keyed by product
 * id so a pick survives paging and searching the product picker, and so the
 * inline preview and the "Preview Section" dialog render the same cards in the
 * same order.
 */

/**
 * A row shaped like `GET /api/admin/products` (picker list) or
 * `GET /api/admin/products/{id}` (lookup). Both carry `basePrice` as a numeric
 * string; only the list row carries the resolved `gender` name, and only the
 * detail row carries variant-level `images`.
 */
export interface CarouselPreviewSourceRow {
  id: string;
  name: string;
  slug: string;
  basePrice: string;
  gender?: string | null;
  collection?: string | null;
  genderId?: string | null;
  thumbnail?: string | null;
  images?: { url: string }[];
  variants?: {
    id?: string;
    price: string;
    isDefault: boolean;
    images?: { url: string }[];
  }[];
}

export type CarouselPreviewCache = Record<string, HomepageProduct>;

export type PreviewFailureReason = "unavailable" | "failed";

export interface PreviewLookupFailure {
  id: string;
  reason: PreviewFailureReason;
}

export type PreviewStatus =
  | "empty"
  | "loading"
  | "ready"
  | "partial"
  | "error";

export interface PreviewState {
  status: PreviewStatus;
  products: HomepageProduct[];
  message: string | null;
  canRetry: boolean;
}

export const PREVIEW_COPY = {
  empty: "Pilih produk untuk melihat preview carousel.",
  loading: "Memuat preview produk…",
  ready: "Preview mengikuti pilihan dan urutan saat ini.",
  failed: "Sebagian atau seluruh preview produk gagal dimuat.",
  unavailable:
    "Preview tidak tersedia untuk sebagian atau seluruh produk yang dipilih.",
} as const;

/** Price and image follow the same rules the picker and the storefront use. */
export function toPreviewProduct(
  row: CarouselPreviewSourceRow
): HomepageProduct {
  const defaultVariant = row.variants?.find((variant) => variant.isDefault);
  const price = parseFloat(defaultVariant?.price ?? row.basePrice);
  const image =
    defaultVariant?.images?.[0]?.url ??
    row.thumbnail ??
    row.variants?.find((variant) => variant.images && variant.images.length > 0)
      ?.images?.[0]?.url ??
    row.images?.[0]?.url ??
    null;

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    price: Number.isNaN(price) ? 0 : price,
    basePrice: parseFloat(row.basePrice) || 0,
    image,
    gender: row.gender ?? null,
    collection: row.collection ?? null,
  };
}

/**
 * Adds rows to the cache without dropping cards the picker no longer shows.
 * Returns the same object when every row is already known, so callers can use
 * identity to skip a re-render.
 */
export function mergePreviewCache(
  cache: CarouselPreviewCache,
  rows: CarouselPreviewSourceRow[]
): CarouselPreviewCache {
  let next: CarouselPreviewCache | null = null;
  for (const row of rows) {
    if (!row || !row.id) continue;
    if (next) {
      next[row.id] = toPreviewProduct(row);
      continue;
    }
    if (cache[row.id]) continue;
    next = { ...cache };
    next[row.id] = toPreviewProduct(row);
  }
  return next ?? cache;
}

/** Cards for `ids` in the picked order; ids without a card are skipped. */
export function orderPreviewProducts(
  ids: string[],
  cache: CarouselPreviewCache
): HomepageProduct[] {
  const products: HomepageProduct[] = [];
  for (const id of ids) {
    const product = cache[id];
    if (product) products.push(product);
  }
  return products;
}

/**
 * What the preview block renders for the current draft. Failures never remove
 * a selection: a temporary failure keeps the retry action, an inaccessible
 * product is reported without disclosing the reason.
 */
export function describePreviewState(input: {
  ids: string[];
  cache: CarouselPreviewCache;
  pending: string[];
  failures: PreviewLookupFailure[];
}): PreviewState {
  const { ids, cache, pending, failures } = input;
  const products = orderPreviewProducts(ids, cache);

  if (ids.length === 0) {
    return { status: "empty", products, message: PREVIEW_COPY.empty, canRetry: false };
  }

  if (pending.length > 0) {
    return {
      status: "loading",
      products,
      message: PREVIEW_COPY.loading,
      canRetry: false,
    };
  }

  const selected = new Set(ids);
  const relevant = failures.filter((failure) => selected.has(failure.id));
  const hasRetryable = relevant.some((failure) => failure.reason === "failed");
  const hasUnavailable = relevant.some(
    (failure) => failure.reason === "unavailable"
  );

  if (hasRetryable) {
    return {
      status: products.length > 0 ? "partial" : "error",
      products,
      message: PREVIEW_COPY.failed,
      canRetry: true,
    };
  }

  if (hasUnavailable) {
    return {
      status: products.length > 0 ? "partial" : "error",
      products,
      message: PREVIEW_COPY.unavailable,
      canRetry: false,
    };
  }

  return {
    status: "ready",
    products,
    message: PREVIEW_COPY.ready,
    canRetry: false,
  };
}
