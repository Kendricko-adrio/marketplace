/**
 * jubelio-sync — Jubelio master-data sync (product catalog + stock + images).
 *
 * Jubelio (`https://api2.jubelio.com`) is the third-party source of truth for
 * products, variants, prices, images, and per-branch stock. This module is the
 * shared worker used by three entry points:
 *   - packages/db/src/import-jubelio.ts  — one-shot full pull (`db:import-jubelio`).
 *   - apps/store/.../api/webhooks/jubelio/route.ts — recurring push deltas.
 *   - apps/admin/.../api/admin/products/[id]/sync/route.ts — single-product
 *     re-sync triggered from the admin product detail page.
 *
 * `db` is injected by the caller so this module does NOT depend on a specific
 * db instance (the script builds its own pool; the apps use their own).
 *
 * Data model (verified live): product = `item_group`, variant = `item/sku`,
 * branch = `location` (physical outlet — NOT `/locations/` which returns only
 * the webstore; use `/locations/list`), stock per (item_id, location_id).
 * Shopee = channel_id 64. See docs/jubelio-sync.md + memory [[jubelio-sync-api]].
 *
 * Invariants (mirror soh-sync.ts; do NOT violate):
 *   - branch_stock.reservedStock is NEVER written here (runtime-managed by
 *     checkout — see [[stock-reservation-design]]). Only `stock` is written.
 *   - New branches upsert as status="nonaktif"; existing branches keep status.
 *   - Upserts keyed on Jubelio natural keys (jubelioItemGroupId / jubelioItemId /
 *     jubelioLocationId / jubelioCategoryId) → idempotent re-runs.
 *   - Brand/category linked by slug (upsert on slug) so Jubelio rows coexist
 *     with pre-existing CSV-SOH rows; actual ids resolved by lookup, not by a
 *     computed prefixed id.
 *   - Sync is upsert-only — never deletes products/stock. Product gallery
 *     images are refreshed per product (the JSONB `images` column is overwritten).
 *   - Image URLs are hotlinked from the Jubelio CDN — never downloaded.
 */

import { createHash } from "node:crypto";
import { sql, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  branches,
  branchStocks,
  brands,
  categories,
  productToCategory,
  products,
  productVariants,
  type ProductImage,
} from "./schema";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

// ---------------------------------------------------------------------------
// Config + client
// ---------------------------------------------------------------------------

const API_BASE =
  process.env.JUBELIO_API_BASE_URL?.replace(/\/$/, "") ||
  "https://api2.jubelio.com";

const NON_OUTLET_LOCATIONS = new Set(
  (process.env.JUBELIO_SKIP_LOCATIONS ||
    "Transit,WEBSITE ADF,MONO DPK ADF OUTLET PUMA,MONO SMB ADF OUTLET PUMA,MULTI DPK ADF OUTLET,MULTI RAWA ADF OUTLET,MULTI SMB ADF OUTLET")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

/** Max retry attempts for 429 / 5xx responses before giving up. */
const MAX_RETRIES = Math.max(0, Number(process.env.JUBELIO_SYNC_MAX_RETRIES || 5));

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Exponential backoff with jitter (base 1s, cap 30s). */
function backoffMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, 30000);
  return base + Math.floor(Math.random() * 500);
}

async function login(): Promise<string> {
  const email = process.env.JUBELIO_EMAIL;
  const password = process.env.JUBELIO_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "jubelio-sync: JUBELIO_EMAIL and JUBELIO_PASSWORD must be set"
    );
  }
  const res = await fetch(`${API_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`jubelio-sync: login failed (${res.status})`);
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) {
    throw new Error("jubelio-sync: login response missing token");
  }
  cachedToken = data.token;
  // Token lasts 12h; refresh a little before.
  tokenExpiresAt = Date.now() + 11 * 60 * 60 * 1000;
  return cachedToken;
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  return login();
}

async function jubelioRequest(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  let token = await getToken();
  let relogged = false;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: token,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {}),
      },
    });

    // 401 — token may have expired early; force re-login once and retry.
    if (res.status === 401 && !relogged) {
      cachedToken = null;
      tokenExpiresAt = 0;
      token = await getToken();
      relogged = true;
      continue;
    }

    // 429 / 5xx — back off and retry (honor Retry-After if Jubelio sends it).
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfter = res.headers.get("retry-after");
      let waitMs: number;
      if (retryAfter && Number.isFinite(Number(retryAfter))) {
        waitMs = Number(retryAfter) * 1000;
      } else {
        waitMs = backoffMs(attempt);
      }
      await sleep(waitMs);
      continue;
    }

    return res;
  }
}

async function jubelioGet<T>(path: string): Promise<T> {
  const res = await jubelioRequest(path);
  if (!res.ok) {
    throw new Error(`jubelio-sync: GET ${path} failed (${res.status})`);
  }
  return (await res.json()) as T;
}

async function jubelioPost<T>(path: string, body: unknown): Promise<T> {
  const res = await jubelioRequest(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`jubelio-sync: POST ${path} failed (${res.status})`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Types (from live Jubelio responses)
// ---------------------------------------------------------------------------

export type JubelioLocation = {
  location_id: number;
  location_name: string;
  location_code: string | null;
  is_pos_outlet: boolean;
  // Fields used by upsertJubelioBranches. The /locations/list response carries
  // many more (province_id, pos_*, warehouse_*, is_fbl/tcb/sbs, etc.) — left
  // optional here and unused because the branch schema doesn't model them.
  is_active?: boolean | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  post_code?: string | null;
  phone?: string | null;
  email?: string | null;
  contact_name?: string | null;
  area?: string | null;
  subdistrict?: string | null;
  coordinate?: string | null;
  location_type?: string | null;
  is_warehouse?: boolean | null;
};

export type JubelioCategory = {
  category_id: number;
  category_name: string;
  parent_id: number;
  has_children: boolean;
};

export type JubelioVariationValue = { label: string; value: string | number };

export type JubelioCatalogImage = {
  group_image_id: number;
  url: string;
  thumbnail: string;
  file_name?: string;
  sequence_number: number;
};

export type JubelioCatalogSku = {
  item_id: number;
  item_code: string;
  sell_price: number | string;
  barcode: string | null;
  variation_values: JubelioVariationValue[];
  end_qty?: number;
};

export type JubelioCatalogProduct = {
  item_group_id: number;
  item_group_name: string;
  description: string | null;
  sell_price: number | string;
  item_category_id: number;
  selected_brand_name: string | null;
  is_active: boolean;
  images: JubelioCatalogImage[];
  product_skus: JubelioCatalogSku[];
};

export type JubelioStockItem = {
  item_id: number;
  item_code: string;
  item_group_id: number;
  location_stocks: {
    location_id: number;
    on_hand?: number;
    available?: number;
    reserved?: number;
  }[];
};

export type JubelioStockResponse = {
  locations: JubelioLocation[];
  data: JubelioStockItem[];
};

/** One product to upsert (catalog detail + optional masters thumbnail). */
export type JubelioProductInput = {
  catalog: JubelioCatalogProduct;
  /** Group thumbnail from /inventory/items/masters (avoids a 2nd hit). */
  thumbnail?: string | null;
};

export type UpsertSummary = {
  branches: number;
  categories: number;
  brands: number;
  products: number;
  variants: number;
  stockRows: number;
};

export type UpsertOptions = { onProgress?: (msg: string) => void };

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

/** All locations (outlets) — use /locations/list, NOT /locations/. */
export async function fetchLocationsList(): Promise<JubelioLocation[]> {
  const d = await jubelioGet<{ data: JubelioLocation[]; totalCount: number }>(
    "/locations/list?page=1&pageSize=100"
  );
  return d.data;
}

/** All item categories (one call returns the full 1.6k tree). */
export async function fetchCategories(): Promise<JubelioCategory[]> {
  const d = await jubelioGet<JubelioCategory[] | { data: JubelioCategory[] }>(
    "/inventory/categories/item-categories/"
  );
  return Array.isArray(d) ? d : (d.data ?? []);
}

export type MastersPage = {
  data: {
    item_group_id: number;
    item_name: string;
    item_category_id: number;
    sell_price: number | string;
    thumbnail: string;
    variants: {
      item_id: number;
      item_code: string;
      variation_values: JubelioVariationValue[];
      sell_price: number | string;
      barcode: string | null;
      available_qty: number;
      end_qty: number;
    }[];
  }[];
  totalCount: number;
};

export async function fetchMastersPage(
  page: number,
  pageSize = 200
): Promise<MastersPage> {
  return jubelioGet<MastersPage>(
    `/inventory/items/masters?page=${page}&pageSize=${pageSize}`
  );
}

/** Full per-product detail (brand, description, gallery images, variants). */
export async function fetchProductCatalog(
  itemGroupId: number
): Promise<JubelioCatalogProduct> {
  return jubelioGet<JubelioCatalogProduct>(
    `/inventory/catalog/${itemGroupId}`
  );
}

/** Per-location stock for a batch of variant item_ids. */
export async function fetchStocks(itemIds: number[]): Promise<JubelioStockResponse> {
  return jubelioPost<JubelioStockResponse>(
    "/inventory/items/all-stocks/",
    { ids: itemIds }
  );
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function slugify(v: string): string {
  return (v || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Deterministic, collision-safe id for a natural key (sha1, 96-bit prefix). */
export function keyId(prefix: string, key: string): string {
  return (
    prefix + createHash("sha1").update(key, "utf8").digest("hex").slice(0, 24)
  );
}

/** Format a Jubelio price ("1700000.0000" | 1700000) → numeric(15,2) string. */
export function money(v: number | string | null | undefined): string {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

/** Map Jubelio variation_values → { size, color } by label. Skips null/empty
 *  values (Jubelio often sends a duplicate English-label entry with value:null,
 *  e.g. [{Ukuran:"5"},{SIZE:null}] — the null must not overwrite the real value). */
function extractVariation(
  variationValues: JubelioVariationValue[] | undefined
): { size: string | null; color: string | null } {
  let size: string | null = null;
  let color: string | null = null;
  for (const v of variationValues ?? []) {
    // Jubelio usually sends value as a string, but some records send a number
    // (e.g. 5 instead of "5"); coerce defensively before .trim().
    const val = v.value == null ? "" : String(v.value).trim();
    if (!val) continue; // skip null/empty — never let a null overwrite a real value
    const label = (v.label || "").toLowerCase();
    if (label.includes("ukuran") || label.includes("size")) {
      if (size === null) size = val;
    } else if (
      label.includes("warna") ||
      label.includes("color") ||
      label.includes("colour")
    ) {
      if (color === null) color = val;
    } else if (size === null) {
      // Fallback: first unmapped variation → size (most Jubelio shoes use Ukuran).
      size = val;
    }
  }
  return { size, color };
}

function* chunked<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

const BATCH_SIZE = 500;

/** Concurrency-limited map (no extra deps). */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  let done = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
      done++;
      onProgress?.(done, items.length);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

// ---------------------------------------------------------------------------
// Upserts
// ---------------------------------------------------------------------------

/**
 * Upsert branches (locations). Skips non-outlet staging locations. New
 * branches → status "nonaktif" (disabled) until an admin enables; existing
 * branches keep their status. Returns the count of upserted outlets.
 */
export async function upsertJubelioBranches(
  db: Db,
  locations: JubelioLocation[],
  options: UpsertOptions = {}
): Promise<number> {
  const log = options.onProgress ?? (() => {});
  const now = new Date();
  const outlets = locations.filter(
    (l) => l.location_name && !NON_OUTLET_LOCATIONS.has(l.location_name.trim())
  );
  log(`upserting ${outlets.length} outlet branches (of ${locations.length} locations)...`);
  for (const chunk of chunked(outlets, BATCH_SIZE)) {
    await db
      .insert(branches)
      .values(
        chunk.map((l) => {
          // coordinate comes as "(lat,lng)" e.g. "(-6.35,106.96)"; most outlets
          // have null — latitude/longitude columns are nullable so that's fine.
          const m = l.coordinate?.match(/\(([-\d.]+),\s*([-\d.]+)\)/);
          // Some outlets (e.g. Transit, location_id -1 Tangerang) have city as
          // null or "-"; fall back so the notNull city column stays valid.
          const city =
            l.city && l.city.trim() && l.city.trim() !== "-"
              ? l.city.trim()
              : "Belum dikonfigurasi";
          const address =
            (l.address && l.address.trim()) || l.location_name.trim();
          return {
            id: keyId("jubelio:branch:", String(l.location_id)),
            name: l.location_name.trim(),
            code: l.location_code ?? String(l.location_id),
            city,
            address,
            latitude: m?.[1] ?? null,
            longitude: m?.[2] ?? null,
            jubelioLocationId: l.location_id,
            status: "nonaktif",
          };
        })
      )
      .onConflictDoUpdate({
        target: branches.jubelioLocationId,
        set: {
          name: sql`excluded.name`,
          city: sql`excluded.city`,
          address: sql`excluded.address`,
          latitude: sql`excluded.latitude`,
          longitude: sql`excluded.longitude`,
          updatedAt: now,
          // status intentionally NOT updated — preserve admin/enabled state.
        },
      });
  }
  return outlets.length;
}

/**
 * Upsert all categories by slug (merges with pre-existing CSV-SOH categories).
 * Multiple Jubelio categories may share a name (→ same slug) — they're deduped
 * for the insert (first category_id wins the row's jubelioCategoryId) and all
 * map to the same our-category id. Returns a map jubelioCategoryId → our id
 * covering ALL input categories (so product links resolve for dup-name cats).
 */
export async function upsertJubelioCategories(
  db: Db,
  cats: JubelioCategory[],
  options: UpsertOptions = {}
): Promise<Map<number, string>> {
  const log = options.onProgress ?? (() => {});
  const now = new Date();
  const slugOf = (c: JubelioCategory) =>
    slugify(c.category_name) || `cat-${c.category_id}`;

  // Dedupe by slug (first wins) — avoids "ON CONFLICT affect row a second time"
  // when a single INSERT batch contains duplicate slugs.
  const seen = new Set<string>();
  const deduped: JubelioCategory[] = [];
  for (const c of cats) {
    const slug = slugOf(c);
    if (!seen.has(slug)) {
      seen.add(slug);
      deduped.push(c);
    }
  }
  log(
    `upserting ${deduped.length} categories (of ${cats.length} — ${
      cats.length - deduped.length
    } dup-name merged)...`
  );
  for (const chunk of chunked(deduped, BATCH_SIZE)) {
    await db
      .insert(categories)
      .values(
        chunk.map((c) => ({
          id: keyId("jubelio:category:", String(c.category_id)),
          name: c.category_name,
          slug: slugOf(c),
          jubelioCategoryId: c.category_id,
        }))
      )
      .onConflictDoUpdate({
        target: categories.slug,
        set: {
          name: sql`excluded.name`,
          jubelioCategoryId: sql`excluded.jubelio_category_id`,
          updatedAt: now,
        },
      });
  }
  // Build jubelioCategoryId → our id by slug (covers ALL inputs incl. dups).
  const rows = await db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories)
    .where(inArray(categories.slug, [...seen]));
  const slugToId = new Map(rows.map((r) => [r.slug, r.id]));
  const map = new Map<number, string>();
  for (const c of cats) {
    const id = slugToId.get(slugOf(c));
    if (id) map.set(c.category_id, id);
  }
  return map;
}

export type UpsertProductsResult = {
  brands: number;
  products: number;
  variants: number;
};

/**
 * Upsert a batch of products (+ their variants, brand links, category links,
 * and product-level gallery images). Brands are upserted by slug (merging with
 * existing rows) and resolved by lookup. Categories are linked via the provided
 * `categoryMap` (jubelioCategoryId → our category id).
 */
export async function upsertJubelioProducts(
  db: Db,
  inputs: JubelioProductInput[],
  categoryMap: Map<number, string>,
  options: UpsertOptions = {}
): Promise<UpsertProductsResult> {
  const log = options.onProgress ?? (() => {});
  const now = new Date();

  if (inputs.length === 0) return { brands: 0, products: 0, variants: 0 };

  // 1. Brands — collect slugs, upsert by slug, resolve actual brandIds.
  const brandSlugs = new Set<string>();
  for (const inp of inputs) {
    const bn = inp.catalog.selected_brand_name?.trim();
    if (bn) brandSlugs.add(slugify(bn));
  }
  for (const slug of brandSlugs) {
    // Find the original-cased name from inputs for this slug.
    const name =
      inputs
        .map((i) => i.catalog.selected_brand_name?.trim())
        .find((n) => n && slugify(n) === slug) || slug;
    await db
      .insert(brands)
      .values({ id: keyId("jubelio:brand:", slug), name, slug })
      .onConflictDoUpdate({
        target: brands.slug,
        set: { name: sql`excluded.name`, updatedAt: now },
      });
  }
  const brandRows = await db
    .select({ id: brands.id, slug: brands.slug })
    .from(brands)
    .where(inArray(brands.slug, [...brandSlugs]));
  const brandIdBySlug = new Map(brandRows.map((r) => [r.slug, r.id]));

  let productCount = 0;
  let variantCount = 0;

  for (const inp of inputs) {
    const c = inp.catalog;
    const groupId = c.item_group_id;
    const productId = keyId("jubelio:product:", String(groupId));
    const brandSlug = c.selected_brand_name?.trim()
      ? slugify(c.selected_brand_name.trim())
      : null;
    const brandId = brandSlug ? brandIdBySlug.get(brandSlug) ?? null : null;

    const name = c.item_group_name?.trim() || `product-${groupId}`;
    const slug = `${slugify(name)}-${groupId}`;
    const thumbnail =
      (inp.thumbnail ?? c.images[0]?.thumbnail ?? c.images[0]?.url) || null;
    const gallery: ProductImage[] = (c.images ?? [])
      .slice()
      .sort((a, b) => (a.sequence_number ?? 0) - (b.sequence_number ?? 0))
      .map((img, i) => ({
        url: img.url,
        thumbnail: img.thumbnail || img.url,
        displayOrder: img.sequence_number ?? i,
      }));

    // 2. Product — upsert on jubelioItemGroupId. status only set on insert
    //    (preserve admin-edited status on conflict).
    await db
      .insert(products)
      .values({
        id: productId,
        name,
        slug,
        description: c.description ?? null,
        basePrice: money(c.sell_price),
        status: "aktif",
        jubelioItemGroupId: groupId,
        thumbnail,
        images: gallery,
        brandId,
      })
      .onConflictDoUpdate({
        target: products.jubelioItemGroupId,
        set: {
          name: sql`excluded.name`,
          slug: sql`excluded.slug`,
          description: sql`excluded.description`,
          basePrice: sql`excluded.base_price`,
          thumbnail: sql`excluded.thumbnail`,
          images: sql`excluded.images`,
          brandId: sql`excluded.brand_id`,
          updatedAt: now,
          // status intentionally NOT updated — preserve admin edits.
        },
      });
    productCount++;

    // 3. Category link.
    const catId = categoryMap.get(c.item_category_id);
    if (catId) {
      await db
        .insert(productToCategory)
        .values({ productId, categoryId: catId })
        .onConflictDoNothing();
    }

    // 4. Variants — upsert on jubelioItemId.
    let firstVariant = true;
    for (const sku of c.product_skus ?? []) {
      const { size, color } = extractVariation(sku.variation_values);
      await db
        .insert(productVariants)
        .values({
          id: keyId("jubelio:variant:", String(sku.item_id)),
          productId,
          sku: sku.item_code,
          color,
          size,
          price: money(sku.sell_price),
          isDefault: firstVariant,
          barcode: sku.barcode ?? null,
          jubelioItemId: sku.item_id,
        })
        .onConflictDoUpdate({
          target: productVariants.jubelioItemId,
          set: {
            sku: sql`excluded.sku`,
            color: sql`excluded.color`,
            size: sql`excluded.size`,
            price: sql`excluded.price`,
            barcode: sql`excluded.barcode`,
            updatedAt: now,
            // isDefault NOT updated — preserve admin edits.
          },
        });
      firstVariant = false;
      variantCount++;
    }
  }

  log(
    `upserted ${productCount} products, ${variantCount} variants, ${brandSlugs.size} brands`
  );
  return {
    brands: brandSlugs.size,
    products: productCount,
    variants: variantCount,
  };
}

/**
 * Upsert per-branch stock. `rows` = per (variant item_id, location_id) on_hand.
 * Never touches reservedStock (checkout-managed invariant). Uses Jubelio
 * `on_hand` (the physical pool); falls back to `available` when on_hand is
 * missing (they're equal when Jubelio reserved=0).
 */
export async function upsertJubelioStock(
  db: Db,
  rows: { itemId: number; locationId: number; onHand: number }[],
  options: UpsertOptions = {}
): Promise<number> {
  const log = options.onProgress ?? (() => {});
  const now = new Date();
  if (rows.length === 0) return 0;
  log(`upserting ${rows.length} branch_stock rows...`);
  for (const chunk of chunked(rows, BATCH_SIZE)) {
    await db
      .insert(branchStocks)
      .values(
        chunk.map((r) => ({
          branchId: keyId("jubelio:branch:", String(r.locationId)),
          productVariantId: keyId("jubelio:variant:", String(r.itemId)),
          stock: r.onHand,
        }))
      )
      .onConflictDoUpdate({
        target: [branchStocks.branchId, branchStocks.productVariantId],
        set: { stock: sql`excluded.stock`, updatedAt: now },
      });
  }
  return rows.length;
}

/**
 * Flatten a /inventory/items/all-stocks/ response into per (item,location)
 * rows. Only outlet locations are included — staging locations (Transit, MONO,
 * MULTI, WEBSITE) are skipped (they're not customer-facing branches and aren't
 * upserted into `branch`), and unknown location_ids are skipped too (avoids FK
 * violations). Uses the response's own `locations[]` to decide what's an outlet.
 */
export function flattenStock(
  resp: JubelioStockResponse
): { itemId: number; locationId: number; onHand: number }[] {
  const outletIds = new Set(
    (resp.locations ?? [])
      .filter(
        (l) =>
          l.location_name && !NON_OUTLET_LOCATIONS.has(l.location_name.trim())
      )
      .map((l) => l.location_id)
  );
  const out: { itemId: number; locationId: number; onHand: number }[] = [];
  for (const item of resp.data ?? []) {
    for (const ls of item.location_stocks ?? []) {
      if (!outletIds.has(ls.location_id)) continue;
      const onHand =
        ls.on_hand ??
        ls.available ??
        (ls.reserved != null && ls.available != null
          ? ls.available + ls.reserved
          : 0);
      if (onHand > 0) {
        out.push({ itemId: item.item_id, locationId: ls.location_id, onHand });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Single-product sync (used by webhook + admin Sync button)
// ---------------------------------------------------------------------------

export async function syncOneProduct(
  db: Db,
  itemGroupId: number
): Promise<{ product: string; variants: number; stockRows: number }> {
  // Ensure categories are present + build the link map.
  const cats = await fetchCategories();
  const categoryMap = await upsertJubelioCategories(db, cats);

  const catalog = await fetchProductCatalog(itemGroupId);
  const prod = await upsertJubelioProducts(db, [{ catalog }], categoryMap);

  // Stock for this product's variants.
  const itemIds = (catalog.product_skus ?? []).map((s) => s.item_id);
  let stockRows = 0;
  if (itemIds.length > 0) {
    const stockResp = await fetchStocks(itemIds);
    stockRows = await upsertJubelioStock(db, flattenStock(stockResp));
  }
  return {
    product: catalog.item_group_name,
    variants: prod.variants,
    stockRows,
  };
}