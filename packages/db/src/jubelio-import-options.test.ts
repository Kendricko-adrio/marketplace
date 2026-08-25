import { describe, expect, it } from "vitest";
import {
  filterExactItemNameMatches,
  parseJubelioImportArgs,
  parseJubelioMaxProducts,
} from "./jubelio-import-options";

const masters = [
  { item_group_id: 1, item_name: "Wild Glide 38" },
  { item_group_id: 2, item_name: "Wild Glide 38 Kids" },
  { item_group_id: 3, item_name: "  wild glide 38  " },
];

describe("Jubelio item-name import options", () => {
  it("reads the exact product name from the public CLI option", () => {
    expect(
      parseJubelioImportArgs(["--item-name=Wild Glide 38"])
    ).toEqual({ itemName: "Wild Glide 38" });
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
