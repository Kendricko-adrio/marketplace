import { describe, expect, it } from "vitest";
import {
  filterExactItemNameMatches,
  parseJubelioImportArgs,
  parseJubelioMaxProducts,
  validateFullJubelioImportOptions,
} from "./jubelio-import-options";

const masters = [
  { item_group_id: 1, item_name: "Wild Glide 38" },
  { item_group_id: 2, item_name: "Wild Glide 38 Kids" },
  { item_group_id: 3, item_name: "  wild glide 38  " },
];

const CLEAN_FULL_ENV = {
  JUBELIO_SYNC_MAX_PRODUCTS: "",
  JUBELIO_SYNC_START_PAGE: "",
};

describe("Jubelio item-name import options", () => {
  it("resume CLI dapat meminta jam cabang dipertahankan tanpa mengubah mode full", () => {
    expect(parseJubelioImportArgs(["--preserve-branch-hours"])).toEqual({
      full: false,
      preserveBranchHours: true,
    });
  });

  it("reads the exact product name from the public CLI option", () => {
    expect(parseJubelioImportArgs(["--item-name=Wild Glide 38"])).toEqual({
      itemName: "Wild Glide 38",
      full: false,
    });
  });

  it("rejects an empty item-name", () => {
    expect(() => parseJubelioImportArgs(["--item-name=   "])).toThrow(
      "--item-name must not be empty"
    );
  });

  it("keeps every exact case-insensitive match and excludes fuzzy results", () => {
    expect(filterExactItemNameMatches(masters, "WILD GLIDE 38")).toEqual([
      masters[0],
      masters[2],
    ]);
  });

  it("treats an empty development cap as unlimited", () => {
    expect(parseJubelioMaxProducts("")).toBe(Infinity);
    expect(parseJubelioMaxProducts("50")).toBe(50);
  });
});

describe("full bootstrap import options", () => {
  it("parses the full/bootstrap flags", () => {
    expect(
      parseJubelioImportArgs([
        "--full",
        "--expected-database=qadfstore_production",
        "--report-file=/home/ops/log/import.json",
      ])
    ).toEqual({
      full: true,
      expectedDatabase: "qadfstore_production",
      reportFile: "/home/ops/log/import.json",
    });
  });

  it("accepts a clean full-import scope", () => {
    expect(
      validateFullJubelioImportOptions(
        {
          full: true,
          expectedDatabase: "qadfstore_production",
          reportFile: "/home/ops/log/import.json",
        },
        CLEAN_FULL_ENV
      )
    ).toEqual({
      mode: "full",
      expectedDatabase: "qadfstore_production",
      reportFile: "/home/ops/log/import.json",
      pageSize: 200,
    });
  });

  it.each([
    [
      { full: true, itemName: "Wild Glide 38", expectedDatabase: "db", reportFile: "/r.json" },
      CLEAN_FULL_ENV,
      "--full",
    ],
    [
      { full: true, expectedDatabase: "db", reportFile: "/r.json" },
      { ...CLEAN_FULL_ENV, JUBELIO_SYNC_MAX_PRODUCTS: "50" },
      "JUBELIO_SYNC_MAX_PRODUCTS",
    ],
    [
      { full: true, expectedDatabase: "db", reportFile: "/r.json" },
      { ...CLEAN_FULL_ENV, JUBELIO_SYNC_START_PAGE: "2" },
      "JUBELIO_SYNC_START_PAGE",
    ],
    [
      { full: true, expectedDatabase: "db", reportFile: "/r.json" },
      { ...CLEAN_FULL_ENV, JUBELIO_SYNC_MAX_PRODUCTS: "abc" },
      "JUBELIO_SYNC_MAX_PRODUCTS",
    ],
    [
      { full: true, reportFile: "/r.json" },
      CLEAN_FULL_ENV,
      "--expected-database",
    ],
    [
      { full: true, expectedDatabase: "db" },
      CLEAN_FULL_ENV,
      "--report-file",
    ],
  ])(
    "refuses an ambiguous full-import request %j",
    (options, env, message) => {
      expect(() =>
        validateFullJubelioImportOptions(options, env)
      ).toThrow(message);
    }
  );

  it("leaves the existing filtered import contract untouched", () => {
    expect(
      validateFullJubelioImportOptions({ full: false }, {})
    ).toBeNull();
  });
});
