import { describe, expect, it } from "vitest";
import { parsePagination } from "./pagination";

describe("parsePagination", () => {
  it("clamps invalid and excessive values", () => {
    expect(parsePagination("-4", "100000")).toEqual({ page: 1, limit: 100 });
    expect(parsePagination("abc", "NaN", 50)).toEqual({ page: 1, limit: 50 });
  });

  it("keeps valid pagination", () => {
    expect(parsePagination("3", "25")).toEqual({ page: 3, limit: 25 });
  });
});
