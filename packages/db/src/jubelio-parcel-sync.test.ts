import { describe, expect, it } from "vitest";
import { enrichJubelioSkuParcels, upsertJubelioProducts, type Db, type JubelioCatalogProduct } from "./jubelio-sync";
import { productVariants } from "./schema/products";
const catalog: JubelioCatalogProduct = { item_group_id: 9, item_group_name: "Fixture shoes", description: null, sell_price: 100000, item_category_id: 0, selected_brand_name: null, is_active: true, images: [], product_skus: [
  { item_id: 101, item_code: "A", sell_price: 100000, barcode: null, variation_values: [] },
  { item_id: 102, item_code: "B", sell_price: 100000, barcode: null, variation_values: [] },
] };
describe("per-SKU master parcel synchronization", () => {
  it("reads each SKU master separately and persists distinct dimensions on insert and conflict", async () => {
    const reads: number[] = [];
    const enriched = await enrichJubelioSkuParcels(catalog, async (id) => { reads.push(id); return { package_weight: id === 101 ? "250" : "300", package_length: "30", package_width: "20", package_height: "10" }; });
    expect(reads).toEqual([101, 102]);
    const variants: Array<Record<string, unknown>> = [];
    const conflicts: Array<Record<string, unknown>> = [];
    const fake = { select: () => ({ from: () => ({ where: async () => [] }) }), insert: (table: unknown) => ({ values: (row: Record<string, unknown>) => ({ onConflictDoUpdate: async (config: { set: Record<string, unknown> }) => { if (table === productVariants) { variants.push(row); conflicts.push(config.set); } } }) }) } as unknown as Db;
    await upsertJubelioProducts(fake, [{ catalog: enriched }], new Map());
    expect(variants.map((row) => row.parcelDimensions)).toEqual([{ weight: 250, length: 30, width: 20, height: 10 }, { weight: 300, length: 30, width: 20, height: 10 }]);
    expect(conflicts).toHaveLength(2);
    for (const conflict of conflicts) expect(conflict).toHaveProperty("parcelDimensions");
  });
  it("invalid master data clears dimensions instead of inventing a group value", async () => {
    const enriched = await enrichJubelioSkuParcels(catalog, async () => ({ package_weight: "0" }));
    expect(enriched.product_skus.map((sku) => sku.parcelDimensions)).toEqual([null, null]);
  });
});
