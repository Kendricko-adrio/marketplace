import { describe, expect, it } from "vitest";
import { parseJubelioStartPage, resolveJubelioThumbnail } from "./jubelio-sync";

describe("resolveJubelioThumbnail", () => {
  it("returns null when both master thumbnail and catalog images are absent", () => {
    expect(resolveJubelioThumbnail(null, null)).toBe(null);
  });
});

describe("parseJubelioStartPage", () => {
  it("defaults to the first page when unset", () => {
    expect(parseJubelioStartPage(undefined)).toBe(1);
  });

  it("accepts a positive integer page", () => {
    expect(parseJubelioStartPage("46")).toBe(46);
  });

  it("rejects non-positive or non-integer pages", () => {
    expect(() => parseJubelioStartPage("0")).toThrow(
      "JUBELIO_SYNC_START_PAGE must be a positive integer"
    );
    expect(() => parseJubelioStartPage("4.5")).toThrow(
      "JUBELIO_SYNC_START_PAGE must be a positive integer"
    );
  });
});
