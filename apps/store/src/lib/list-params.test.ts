import { describe, it, expect } from "vitest";
import { parseListParams } from "./list-params";

function q(s: string): URLSearchParams {
  return new URLSearchParams(s);
}

describe("parseListParams", () => {
  it("defaults to page 1, limit 12, createdAt desc", () => {
    expect(parseListParams(q(""))).toEqual({
      page: 1,
      limit: 12,
      offset: 0,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
  });

  it("honors the default limit override", () => {
    expect(parseListParams(q(""), 20).limit).toBe(20);
  });

  it("computes the offset from page and limit", () => {
    expect(parseListParams(q("page=3&limit=20")).offset).toBe(40);
  });

  it("parses price sort and asc order", () => {
    expect(parseListParams(q("sortBy=price&sortOrder=asc"))).toMatchObject({
      sortBy: "price",
      sortOrder: "asc",
    });
  });

  it("falls back to defaults for unknown sort values", () => {
    expect(parseListParams(q("sortBy=bestseller&sortOrder=sideways"))).toMatchObject({
      sortBy: "createdAt",
      sortOrder: "desc",
    });
  });

  it("clamps invalid page/limit to sane bounds", () => {
    expect(parseListParams(q("page=abc&limit=abc"))).toMatchObject({
      page: 1,
      limit: 12,
    });
    expect(parseListParams(q("page=0&limit=0"))).toMatchObject({
      page: 1,
      limit: 1,
    });
    expect(parseListParams(q("page=999&limit=9999"))).toMatchObject({
      page: 999,
      limit: 100,
    });
  });
});
