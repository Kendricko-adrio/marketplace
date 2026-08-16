import { describe, it, expect } from "vitest";
import { slugify, keyId } from "./ids";

describe("slugify", () => {
  it("lowercases and replaces spaces with dashes", () => {
    expect(slugify("AirRunner Pro Running Shoes")).toBe(
      "airrunner-pro-running-shoes"
    );
  });

  it("strips non-alphanumeric characters", () => {
    expect(slugify("Court Master! Sneakers?")).toBe("court-master-sneakers");
  });

  it("collapses runs of separators into a single dash", () => {
    expect(slugify("Urban  Chelsea  Boots")).toBe("urban-chelsea-boots");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugify("  --Nike--  ")).toBe("nike");
  });

  it("handles empty and undefined input", () => {
    expect(slugify("")).toBe("");
    expect(slugify(undefined as unknown as string)).toBe("");
  });
});

describe("keyId", () => {
  it("is deterministic for the same input", () => {
    expect(keyId("soh:brand:", "AirRunner")).toBe(
      keyId("soh:brand:", "AirRunner")
    );
  });

  it("returns the documented sha1 96-bit prefix (known-good literal)", () => {
    // Pinned literal — sha1("AirRunner") hex prefix, computed independently.
    expect(keyId("soh:brand:", "AirRunner")).toBe(
      "soh:brand:ab197cbab074ab71856ce1c8"
    );
  });

  it("differs across prefixes and keys", () => {
    expect(keyId("soh:brand:", "AirRunner")).not.toBe(
      keyId("soh:gender:", "AirRunner")
    );
    expect(keyId("soh:brand:", "AirRunner")).not.toBe(
      keyId("soh:brand:", "StreetStyle")
    );
  });
});
