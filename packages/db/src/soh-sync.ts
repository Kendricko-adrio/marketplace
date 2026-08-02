/**
 * soh-sync — shared logic for importing/syncing Stock-On-Hand (SOH) master
 * data from the third-party supplier system into the marketplace DB.
 *
 * Two entry points use this module:
 *   - packages/db/src/import-soh.ts  — one-shot CSV migration (first load).
 *   - apps/store/.../api/webhooks/soh/route.ts — recurring updates (webhook).
 *
 * `db` is injected by the caller so this module does NOT depend on a specific
 * db instance (the script uses packages/db's pool; the store app uses its own).
 *
 * Key invariants:
 *   - branch_stock.reservedStock is NEVER touched here (runtime-managed by the
 *     checkout flow — see stock-reservation design + sweep-reservations cron).
 *   - New branches are inserted as status="nonaktif" (disabled) so stock for
 *     unknown outlets stays hidden from customers until an admin enables them.
 *     Existing branches keep their status (status is NOT updated on conflict).
 *   - Upserts are keyed on natural keys (articleNumber / sku / code / slug /
 *     composite branch+variant) so re-imports and webhook replays are idempotent.
 *   - IDs are deterministic (sha1 of the natural key) so FK links (variant →
 *     product, branch_stock → variant/branch) stay stable across re-runs.
 *   - product.status is "aktif" for imported rows; the CSV "STATUS" column is
 *     NOT the product status enum — it maps to product.collection (a label).
 *   - brand & gender are normalized dimensions: the CSV "Brand"/"sex" modal
 *     value per ART is upserted into the `brands`/`genders` tables (by slug,
 *     sync-managed, no admin CRUD) and linked to products via brandId/genderId.
 */

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  branches,
  branchStocks,
  brands,
  categories,
  genders,
  productToCategory,
  products,
  productVariants,
} from "./schema";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One SOH row exactly as exported by the third-party master system (CSV cols). */
export type SohRecord = {
  barcode: string;
  namaGudang: string;
  toko: string;
  brand: string;
  prdsgroup: string;
  sex: string;
  art: string;
  namaArtikel: string;
  size: string;
  rrp: string;
  disc: string; // CSV "disc%"
  nett: string;
  status: string; // CSV "STATUS" → product.collection
  season: string;
  total: string;
};

/** CSV header name → SohRecord field. */
export const SOH_CSV_HEADER_MAP: Record<string, keyof SohRecord> = {
  Barcode: "barcode",
  NamaGudang: "namaGudang",
  Toko: "toko",
  Brand: "brand",
  PRDSGROUP: "prdsgroup",
  sex: "sex",
  ART: "art",
  NamaArtikel: "namaArtikel",
  Size: "size",
  RRP: "rrp",
  "disc%": "disc",
  Nett: "nett",
  STATUS: "status",
  Season: "season",
  Total: "total",
};

/** Map a parsed CSV row (header-keyed object) to a SohRecord (all fields defaulted). */
export function csvRowToSohRecord(row: Record<string, string>): SohRecord {
  const rec: SohRecord = {
    barcode: "",
    namaGudang: "",
    toko: "",
    brand: "",
    prdsgroup: "",
    sex: "",
    art: "",
    namaArtikel: "",
    size: "",
    rrp: "",
    disc: "",
    nett: "",
    status: "",
    season: "",
    total: "",
  };
  for (const [csvKey, field] of Object.entries(SOH_CSV_HEADER_MAP)) {
    const val = row[csvKey];
    if (val !== undefined) (rec as Record<string, string>)[field] = val;
  }
  return rec;
}

export type AggregatedSoh = {
  branches: { id: string; name: string; code: string }[];
  categories: { id: string; name: string; slug: string }[];
  brands: { id: string; name: string; slug: string }[];
  genders: { id: string; name: string; slug: string }[];
  products: {
    id: string;
    name: string;
    slug: string;
    basePrice: string;
    articleNumber: string;
    brand: string | null;
    gender: string | null;
    season: string | null;
    collection: string | null;
  }[];
  productCategories: { productId: string; categoryId: string }[];
  variants: {
    id: string;
    productId: string;
    sku: string;
    size: string;
    price: string;
    isDefault: boolean;
    barcode: string | null;
    discount: string | null;
  }[];
  stock: { branchId: string; productVariantId: string; stock: number }[];
};

export type UpsertSummary = {
  branches: number;
  categories: number;
  brands: number;
  genders: number;
  products: number;
  variants: number;
  stockRows: number;
  totalQty: number;
};

export type UpsertOptions = { onProgress?: (msg: string) => void };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Parse a CSV amount like " 5,250,000 " (thousand-comma separators, optional
 * surrounding quotes/spaces) into a bare numeric string for numeric(15,2).
 */
export function parseAmount(v: string): string {
  if (!v) return "0";
  const s = v.replace(/["']/g, "").replace(/\s/g, "").replace(/,/g, "");
  const cleaned = s.replace(/[^0-9.]/g, "");
  if (!cleaned || cleaned === ".") return "0";
  return cleaned;
}

/** Parse an integer quantity ("12", "-3") → number (0 on failure). */
export function parseQty(v: string): number {
  if (!v) return 0;
  const n = parseInt(v.replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

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

/** Collapse internal whitespace to "-" for sku parts (keeps case). */
function sanitizeSkuPart(v: string): string {
  return (v || "").trim().replace(/\s+/g, "-");
}

/** Most-frequent non-empty key in a counter map (ties → first inserted). */
function pickMode(counts: Map<string, number>): string {
  let best = "";
  let bestCount = -1;
  for (const [k, c] of counts) {
    if (!k) continue;
    if (c > bestCount) {
      bestCount = c;
      best = k;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Aggregation (single pass over records → grouped maps)
// ---------------------------------------------------------------------------

interface ProductAgg {
  art: string;
  id: string;
  nameCounts: Map<string, number>;
  longestName: string;
  brandCounts: Map<string, number>;
  prdsgroupCounts: Map<string, number>;
  sexCounts: Map<string, number>;
  seasonCounts: Map<string, number>;
  collectionCounts: Map<string, number>;
  rrp: string; // RRP is constant per ART → first non-empty wins
  defaultAssigned: boolean;
}

interface VariantAgg {
  art: string;
  size: string;
  id: string;
  productId: string;
  barcode: string;
  nettDiscCounts: Map<string, number>; // `${nett}::${disc}` → count
  modalNett: string;
  modalDisc: string;
  isDefault: boolean;
}

export function aggregateSohRecords(records: SohRecord[]): AggregatedSoh {
  const branchByGudang = new Map<string, { id: string; name: string; code: string }>();
  const categoryBySlug = new Map<string, { id: string; name: string; slug: string }>();
  const brandBySlug = new Map<string, { id: string; name: string; slug: string }>();
  const genderBySlug = new Map<string, { id: string; name: string; slug: string }>();
  const productByArt = new Map<string, ProductAgg>();
  const variantByKey = new Map<string, VariantAgg>();
  const stockByKey = new Map<string, number>();

  for (const raw of records) {
    const art = (raw.art || "").trim();
    const namaGudang = (raw.namaGudang || "").trim();
    if (!art || !namaGudang) continue; // missing the two natural keys → skip

    const toko = (raw.toko || "").trim() || namaGudang;
    const size = (raw.size || "").trim();
    const namaArtikel = (raw.namaArtikel || "").trim();
    const brand = (raw.brand || "").trim();
    const prdsgroup = (raw.prdsgroup || "").trim();
    const sex = (raw.sex || "").trim();
    const season = (raw.season || "").trim();
    const status = (raw.status || "").trim();
    const rrp = (raw.rrp || "").trim();
    const nett = (raw.nett || "").trim();
    const disc = (raw.disc || "").trim();
    const barcode = (raw.barcode || "").trim();

    // branch — keyed by NamaGudang; code = Toko (1:1, unique)
    if (!branchByGudang.has(namaGudang)) {
      branchByGudang.set(namaGudang, {
        id: keyId("soh:branch:", toko),
        name: namaGudang,
        code: toko,
      });
    }

    // product — keyed by ART
    let product = productByArt.get(art);
    if (!product) {
      product = {
        art,
        id: keyId("soh:product:", art),
        nameCounts: new Map(),
        longestName: "",
        brandCounts: new Map(),
        prdsgroupCounts: new Map(),
        sexCounts: new Map(),
        seasonCounts: new Map(),
        collectionCounts: new Map(),
        rrp: "",
        defaultAssigned: false,
      };
      productByArt.set(art, product);
    }
    if (namaArtikel) {
      product.nameCounts.set(
        namaArtikel,
        (product.nameCounts.get(namaArtikel) || 0) + 1
      );
      if (namaArtikel.length > product.longestName.length)
        product.longestName = namaArtikel;
    }
    if (brand)
      product.brandCounts.set(brand, (product.brandCounts.get(brand) || 0) + 1);
    if (prdsgroup)
      product.prdsgroupCounts.set(
        prdsgroup,
        (product.prdsgroupCounts.get(prdsgroup) || 0) + 1
      );
    if (sex) product.sexCounts.set(sex, (product.sexCounts.get(sex) || 0) + 1);
    if (season)
      product.seasonCounts.set(
        season,
        (product.seasonCounts.get(season) || 0) + 1
      );
    if (status)
      product.collectionCounts.set(
        status,
        (product.collectionCounts.get(status) || 0) + 1
      );
    if (rrp && !product.rrp) product.rrp = rrp;

    // variant — keyed by (ART, Size)
    const vkey = art + " " + size;
    let variant = variantByKey.get(vkey);
    if (!variant) {
      variant = {
        art,
        size,
        id: keyId("soh:variant:", vkey),
        productId: product.id,
        barcode,
        nettDiscCounts: new Map(),
        modalNett: "",
        modalDisc: "",
        isDefault: !product.defaultAssigned,
      };
      if (!product.defaultAssigned) product.defaultAssigned = true;
      variantByKey.set(vkey, variant);
    }
    if (!variant.barcode && barcode) variant.barcode = barcode;
    const ndKey = `${nett}::${disc}`;
    variant.nettDiscCounts.set(
      ndKey,
      (variant.nettDiscCounts.get(ndKey) || 0) + 1
    );

    // stock — sum Total per (branch, variant). Per-row Total is per
    // (Barcode × NamaGudang) = per (variant × branch); summing is a safety net
    // for the one known barcode collision (Size 4 vs 4-).
    const branchId = branchByGudang.get(namaGudang)!.id;
    const skey = branchId + "::" + variant.id;
    stockByKey.set(skey, (stockByKey.get(skey) || 0) + parseQty(raw.total));
  }

  // resolve modal (nett, disc) pair per variant
  for (const v of variantByKey.values()) {
    let best = "";
    let bestCount = -1;
    for (const [k, c] of v.nettDiscCounts) {
      if (c > bestCount) {
        bestCount = c;
        best = k;
      }
    }
    if (best) {
      const [nett, disc] = best.split("::");
      v.modalNett = nett ?? "";
      v.modalDisc = disc ?? "";
    }
  }

  // products + category links
  const productsArr: AggregatedSoh["products"] = [];
  const productCategories: AggregatedSoh["productCategories"] = [];
  for (const p of productByArt.values()) {
    const name = p.longestName || p.art;
    const prdsgroup = pickMode(p.prdsgroupCounts);
    const slug = slugify(name) + "-" + slugify(p.art);
    const brand = pickMode(p.brandCounts);
    const gender = pickMode(p.sexCounts);
    productsArr.push({
      id: p.id,
      name,
      slug,
      basePrice: parseAmount(p.rrp),
      articleNumber: p.art,
      brand: brand || null,
      gender: gender || null,
      season: pickMode(p.seasonCounts) || null,
      collection: pickMode(p.collectionCounts) || null,
    });
    if (brand) {
      const bslug = slugify(brand);
      if (!brandBySlug.has(bslug))
        brandBySlug.set(bslug, { id: keyId("soh:brand:", bslug), name: brand, slug: bslug });
    }
    if (gender) {
      const gslug = slugify(gender);
      if (!genderBySlug.has(gslug))
        genderBySlug.set(gslug, { id: keyId("soh:gender:", gslug), name: gender, slug: gslug });
    }
    if (prdsgroup) {
      const cslug = slugify(prdsgroup);
      if (!categoryBySlug.has(cslug)) {
        categoryBySlug.set(cslug, {
          id: keyId("soh:category:", cslug),
          name: prdsgroup,
          slug: cslug,
        });
      }
      productCategories.push({
        productId: p.id,
        categoryId: categoryBySlug.get(cslug)!.id,
      });
    }
  }

  const variantsArr: AggregatedSoh["variants"] = [];
  for (const v of variantByKey.values()) {
    variantsArr.push({
      id: v.id,
      productId: v.productId,
      sku: `${sanitizeSkuPart(v.art)}-${sanitizeSkuPart(v.size)}`,
      size: v.size,
      price: parseAmount(v.modalNett),
      isDefault: v.isDefault,
      barcode: v.barcode || null,
      discount: v.modalDisc || null,
    });
  }

  const stockArr: AggregatedSoh["stock"] = [];
  for (const [k, qty] of stockByKey) {
    const [branchId, variantId] = k.split("::");
    stockArr.push({ branchId, productVariantId: variantId, stock: qty });
  }

  return {
    branches: [...branchByGudang.values()],
    categories: [...categoryBySlug.values()],
    brands: [...brandBySlug.values()],
    genders: [...genderBySlug.values()],
    products: productsArr,
    productCategories,
    variants: variantsArr,
    stock: stockArr,
  };
}

// ---------------------------------------------------------------------------
// Upsert (batched, idempotent; no outer transaction — re-runnable)
// ---------------------------------------------------------------------------

function* chunked<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

const BATCH_SIZE = 500;

export async function upsertSohRecords(
  db: Db,
  records: SohRecord[],
  options: UpsertOptions = {}
): Promise<UpsertSummary> {
  const log = options.onProgress ?? (() => {});
  const agg = aggregateSohRecords(records);
  log(
    `aggregated: ${agg.branches.length} branches, ${agg.categories.length} categories, ` +
      `${agg.brands.length} brands, ${agg.genders.length} genders, ` +
      `${agg.products.length} products, ${agg.variants.length} variants, ${agg.stock.length} stock rows`
  );

  const now = new Date();

  // 1. branches — upsert on `code`; update name only, PRESERVE status.
  //    New branches insert as "nonaktif" (disabled) until an admin enables.
  log("upserting branches...");
  for (const chunk of chunked(agg.branches, BATCH_SIZE)) {
    await db
      .insert(branches)
      .values(
        chunk.map((b) => ({
          id: b.id,
          name: b.name,
          code: b.code,
          city: "Belum dikonfigurasi",
          address: b.name,
          status: "nonaktif",
        }))
      )
      .onConflictDoUpdate({
        target: branches.code,
        set: { name: sql`excluded.name`, updatedAt: now },
      });
  }

  // 2. categories — upsert on slug; do-nothing on conflict.
  log("upserting categories...");
  for (const chunk of chunked(agg.categories, BATCH_SIZE)) {
    await db
      .insert(categories)
      .values(chunk.map((c) => ({ id: c.id, name: c.name, slug: c.slug })))
      .onConflictDoNothing({ target: categories.slug });
  }

  // 2b. brands — upsert on slug; update name (sync-managed dimension, no admin
  //     CRUD). id is deterministic (keyId of slug) so products.brand_id can be
  //     computed without a lookup. Must run BEFORE products (FK order).
  log("upserting brands...");
  for (const chunk of chunked(agg.brands, BATCH_SIZE)) {
    await db
      .insert(brands)
      .values(chunk.map((b) => ({ id: b.id, name: b.name, slug: b.slug })))
      .onConflictDoUpdate({
        target: brands.slug,
        set: { name: sql`excluded.name`, updatedAt: now },
      });
  }

  // 2c. genders — upsert on slug; update name (sync-managed dimension).
  log("upserting genders...");
  for (const chunk of chunked(agg.genders, BATCH_SIZE)) {
    await db
      .insert(genders)
      .values(chunk.map((g) => ({ id: g.id, name: g.name, slug: g.slug })))
      .onConflictDoUpdate({
        target: genders.slug,
        set: { name: sql`excluded.name`, updatedAt: now },
      });
  }

  // 3. products — upsert on articleNumber; update name/slug/price/metadata.
  //    Do NOT touch status / description / flash-sale / rating / sold (preserve
  //    admin edits + keep flash-sale fields out of the import scope).
  log("upserting products...");
  for (const chunk of chunked(agg.products, BATCH_SIZE)) {
    await db
      .insert(products)
      .values(
        chunk.map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          basePrice: p.basePrice,
          status: "aktif",
          articleNumber: p.articleNumber,
          brandId: p.brand ? keyId("soh:brand:", slugify(p.brand)) : null,
          genderId: p.gender ? keyId("soh:gender:", slugify(p.gender)) : null,
          season: p.season,
          collection: p.collection,
        }))
      )
      .onConflictDoUpdate({
        target: products.articleNumber,
        set: {
          name: sql`excluded.name`,
          slug: sql`excluded.slug`,
          basePrice: sql`excluded.base_price`,
          brandId: sql`excluded.brand_id`,
          genderId: sql`excluded.gender_id`,
          season: sql`excluded.season`,
          collection: sql`excluded.collection`,
          updatedAt: now,
        },
      });
  }

  // 4. product_to_category — composite PK; do-nothing on conflict.
  log("upserting product_to_category...");
  for (const chunk of chunked(agg.productCategories, BATCH_SIZE)) {
    await db.insert(productToCategory).values(chunk).onConflictDoNothing();
  }

  // 5. product_variants — upsert on sku; update size/price/barcode/discount.
  //    Do NOT touch color / isDefault (preserve admin edits).
  log("upserting product_variants...");
  for (const chunk of chunked(agg.variants, BATCH_SIZE)) {
    await db
      .insert(productVariants)
      .values(
        chunk.map((v) => ({
          id: v.id,
          productId: v.productId,
          sku: v.sku,
          size: v.size,
          price: v.price,
          isDefault: v.isDefault,
          barcode: v.barcode,
          discount: v.discount,
        }))
      )
      .onConflictDoUpdate({
        target: productVariants.sku,
        set: {
          size: sql`excluded.size`,
          price: sql`excluded.price`,
          barcode: sql`excluded.barcode`,
          discount: sql`excluded.discount`,
          updatedAt: now,
        },
      });
  }

  // 6. branch_stock — upsert on composite PK; set `stock` only.
  //    reservedStock is NEVER touched (runtime-managed by checkout).
  log("upserting branch_stock...");
  let totalQty = 0;
  for (const chunk of chunked(agg.stock, BATCH_SIZE)) {
    for (const s of chunk) totalQty += s.stock;
    await db
      .insert(branchStocks)
      .values(
        chunk.map((s) => ({
          branchId: s.branchId,
          productVariantId: s.productVariantId,
          stock: s.stock,
        }))
      )
      .onConflictDoUpdate({
        target: [branchStocks.branchId, branchStocks.productVariantId],
        set: { stock: sql`excluded.stock`, updatedAt: now },
      });
  }

  const summary: UpsertSummary = {
    branches: agg.branches.length,
    categories: agg.categories.length,
    brands: agg.brands.length,
    genders: agg.genders.length,
    products: agg.products.length,
    variants: agg.variants.length,
    stockRows: agg.stock.length,
    totalQty,
  };
  log(`done: ${JSON.stringify(summary)}`);
  return summary;
}