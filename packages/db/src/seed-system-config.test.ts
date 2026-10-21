import { describe, expect, it } from "vitest";
import {
  discountImportSystemConfigSeedRows,
  shipmentSystemConfigSeedRows,
} from "./seed-system-config";

describe("shipment system config seed", () => {
  it("seeds the approved per-unit fallback parcel dimensions for delivery quotes", () => {
    const fallback = shipmentSystemConfigSeedRows.find((row) => row.key === "shipment.parcelFallback");
    expect(fallback?.type).toBe("json");
    expect(JSON.parse(fallback!.value)).toEqual({ weight: 250, length: 30, width: 20, height: 10 });
  });

  it("seeds 15 grams as the packaging weight for delivery quotes", () => {
    expect(
      shipmentSystemConfigSeedRows.find((row) => row.key === "shipment.packagingWeightGrams")?.value
    ).toBe("15");
  });
});

describe("discount import system config seed", () => {
  // Expected values are the approved spec §6.2 defaults, written literally so a
  // drift in the seeder fails here instead of silently changing the bound.
  it("seeds the row-count limit for Markdown import/bulk at 1000", () => {
    const row = discountImportSystemConfigSeedRows.find(
      (entry) => entry.key === "discount.import.maxRows"
    );
    expect(row?.value).toBe("1000");
    expect(row?.type).toBe("number");
  });

  it("seeds the compressed workbook size limit at 5 MiB", () => {
    const row = discountImportSystemConfigSeedRows.find(
      (entry) => entry.key === "discount.import.maxFileBytes"
    );
    expect(row?.value).toBe("5242880");
    expect(row?.type).toBe("number");
  });

  it("seeds the expanded workbook size limit at 25 MiB", () => {
    const row = discountImportSystemConfigSeedRows.find(
      (entry) => entry.key === "discount.import.maxExpandedBytes"
    );
    expect(row?.value).toBe("26214400");
    expect(row?.type).toBe("number");
  });
});
