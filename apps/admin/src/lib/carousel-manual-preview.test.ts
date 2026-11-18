import { describe, it, expect } from "vitest";
import {
  describePreviewState,
  mergePreviewCache,
  orderPreviewProducts,
  toPreviewProduct,
  type CarouselPreviewSourceRow,
} from "./carousel-manual-preview";

// Backs the manual-mode preview inside the homepage carousel editor: the
// admin must see the picked products as cards, in the picked order, without
// the picker's current search page deciding what is visible.

const LIST_ROW: CarouselPreviewSourceRow = {
  id: "prod-kaos",
  name: "Kaos Training WTR D4T",
  slug: "kaos-training-wtr-d4t",
  basePrice: "120000",
  gender: "Pria",
  collection: "Training",
  thumbnail: "/uploads/kaos.jpg",
  variants: [
    { price: "100000", isDefault: true },
    { price: "110000", isDefault: false },
  ],
};

const DETAIL_ROW: CarouselPreviewSourceRow = {
  id: "prod-celana",
  name: "Celana Okcir Bagus",
  slug: "celana-okcir-bagus",
  basePrice: "200000",
  genderId: "gender-1",
  images: [{ url: "/uploads/celana-katalog.jpg" }],
  variants: [
    {
      id: "variant-1",
      price: "180000",
      isDefault: true,
      images: [{ url: "/uploads/celana-varian.jpg" }],
    },
  ],
};

describe("toPreviewProduct", () => {
  it("maps a picker list row, using the default variant price and thumbnail", () => {
    expect(toPreviewProduct(LIST_ROW)).toEqual({
      id: "prod-kaos",
      name: "Kaos Training WTR D4T",
      slug: "kaos-training-wtr-d4t",
      price: 100000,
      basePrice: 120000,
      image: "/uploads/kaos.jpg",
      gender: "Pria",
      collection: "Training",
    });
  });

  it("maps a product-detail row, preferring the default variant image", () => {
    expect(toPreviewProduct(DETAIL_ROW)).toEqual({
      id: "prod-celana",
      name: "Celana Okcir Bagus",
      slug: "celana-okcir-bagus",
      price: 180000,
      basePrice: 200000,
      image: "/uploads/celana-varian.jpg",
      gender: null,
      collection: null,
    });
  });

  it("falls back to the catalog image, then to no image, when variants carry none", () => {
    const catalogOnly: CarouselPreviewSourceRow = {
      ...DETAIL_ROW,
      variants: [{ price: "180000", isDefault: true }],
    };
    expect(toPreviewProduct(catalogOnly).image).toBe(
      "/uploads/celana-katalog.jpg"
    );

    const bare: CarouselPreviewSourceRow = {
      id: "prod-bare",
      name: "Produk Tanpa Gambar",
      slug: "produk-tanpa-gambar",
      basePrice: "50000",
    };
    expect(toPreviewProduct(bare)).toMatchObject({
      price: 50000,
      basePrice: 50000,
      image: null,
    });
  });
});

describe("mergePreviewCache", () => {
  it("keeps products the picker no longer has on the current page", () => {
    const cache = mergePreviewCache({}, [LIST_ROW]);
    const merged = mergePreviewCache(cache, [DETAIL_ROW]);

    expect(Object.keys(merged).sort()).toEqual(["prod-celana", "prod-kaos"]);
    expect(merged["prod-kaos"]).toEqual(cache["prod-kaos"]);
  });

  it("returns the same object when the rows add nothing new", () => {
    const cache = mergePreviewCache({}, [LIST_ROW]);
    expect(mergePreviewCache(cache, [LIST_ROW])).toBe(cache);
  });
});

describe("orderPreviewProducts", () => {
  it("follows the picked order and skips ids without a cached card", () => {
    const cache = mergePreviewCache({}, [LIST_ROW, DETAIL_ROW]);
    expect(
      orderPreviewProducts(["prod-celana", "prod-missing", "prod-kaos"], cache).map(
        (product) => product.id
      )
    ).toEqual(["prod-celana", "prod-kaos"]);
  });
});

describe("describePreviewState", () => {
  const cache = mergePreviewCache({}, [LIST_ROW, DETAIL_ROW]);

  it("asks the admin to pick products when nothing is selected", () => {
    const state = describePreviewState({
      ids: [],
      cache,
      pending: [],
      failures: [],
    });
    expect(state.status).toBe("empty");
    expect(state.products).toEqual([]);
    expect(state.message).toBe("Pilih produk untuk melihat preview carousel.");
    expect(state.canRetry).toBe(false);
  });

  it("reports loading while lookups are still running", () => {
    const state = describePreviewState({
      ids: ["prod-kaos", "prod-celana", "prod-baru"],
      cache,
      pending: ["prod-baru"],
      failures: [],
    });
    expect(state.status).toBe("loading");
    expect(state.products.map((product) => product.id)).toEqual([
      "prod-kaos",
      "prod-celana",
    ]);
  });

  it("is ready once every picked product has a card", () => {
    const state = describePreviewState({
      ids: ["prod-kaos", "prod-celana"],
      cache,
      pending: [],
      failures: [],
    });
    expect(state.status).toBe("ready");
    expect(state.message).toBe(
      "Preview mengikuti pilihan dan urutan saat ini."
    );
  });

  it("offers a retry for temporary lookup failures without dropping the cards", () => {
    const state = describePreviewState({
      ids: ["prod-kaos", "prod-celana", "prod-baru"],
      cache,
      pending: [],
      failures: [{ id: "prod-baru", reason: "failed" }],
    });
    expect(state.status).toBe("partial");
    expect(state.products.map((product) => product.id)).toEqual([
      "prod-kaos",
      "prod-celana",
    ]);
    expect(state.message).toBe(
      "Sebagian atau seluruh preview produk gagal dimuat."
    );
    expect(state.canRetry).toBe(true);
  });

  it("explains an inaccessible product without exposing why and without a retry", () => {
    const state = describePreviewState({
      ids: ["prod-kaos", "prod-celana", "prod-cabang-lain"],
      cache,
      pending: [],
      failures: [{ id: "prod-cabang-lain", reason: "unavailable" }],
    });
    expect(state.status).toBe("partial");
    expect(state.products).toHaveLength(2);
    expect(state.message).toBe(
      "Preview tidak tersedia untuk sebagian atau seluruh produk yang dipilih."
    );
    expect(state.canRetry).toBe(false);
  });

  it("reports an error when no selected product could be loaded", () => {
    const state = describePreviewState({
      ids: ["prod-kaos"],
      cache: {},
      pending: [],
      failures: [{ id: "prod-kaos", reason: "failed" }],
    });
    expect(state.status).toBe("error");
    expect(state.products).toEqual([]);
    expect(state.canRetry).toBe(true);
  });

  it("prefers the retryable message when both failure kinds are present", () => {
    const state = describePreviewState({
      ids: ["prod-kaos", "prod-celana"],
      cache: {},
      pending: [],
      failures: [
        { id: "prod-kaos", reason: "failed" },
        { id: "prod-celana", reason: "unavailable" },
      ],
    });
    expect(state.status).toBe("error");
    expect(state.message).toBe(
      "Sebagian atau seluruh preview produk gagal dimuat."
    );
    expect(state.canRetry).toBe(true);
  });
});
