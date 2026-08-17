import { describe, it, expect } from "vitest";
import { footerConfigSchema } from "./footer-config";

// Backs PUT /api/admin/footer validation. Limits from docs/features/footer.md.
describe("footerConfigSchema", () => {
  it("accepts a minimal valid config", () => {
    const parsed = footerConfigSchema.parse({
      brandName: "StoreFront",
      copyrightText: "© 2026 StoreFront",
    });
    expect(parsed.columns).toEqual([]);
    expect(parsed.socialMedia).toEqual([]);
  });

  it("rejects an empty brand name", () => {
    expect(() =>
      footerConfigSchema.parse({ brandName: "", copyrightText: "x" })
    ).toThrow();
  });

  it("rejects an empty copyright", () => {
    expect(() =>
      footerConfigSchema.parse({ brandName: "StoreFront", copyrightText: "" })
    ).toThrow();
  });

  it("rejects more than 3 columns", () => {
    const columns = Array.from({ length: 4 }, (_, i) => ({
      title: `Kolom ${i}`,
      links: [],
    }));
    expect(() =>
      footerConfigSchema.parse({ brandName: "S", copyrightText: "c", columns })
    ).toThrow();
  });

  it("rejects more than 5 links in a column", () => {
    const links = Array.from({ length: 6 }, (_, i) => ({
      label: `L${i}`,
      href: `/pages/${i}`,
    }));
    expect(() =>
      footerConfigSchema.parse({
        brandName: "S",
        copyrightText: "c",
        columns: [{ title: "Kolom", links }],
      })
    ).toThrow();
  });

  it("rejects an unknown social platform", () => {
    expect(() =>
      footerConfigSchema.parse({
        brandName: "S",
        copyrightText: "c",
        socialMedia: [{ platform: "myspace", url: "https://x", enabled: true }],
      })
    ).toThrow();
  });

  it("accepts all 7 fixed platforms", () => {
    const platforms = [
      "instagram",
      "facebook",
      "twitter",
      "tiktok",
      "youtube",
      "linkedin",
      "whatsapp",
    ];
    const parsed = footerConfigSchema.parse({
      brandName: "S",
      copyrightText: "c",
      socialMedia: platforms.map((platform) => ({
        platform,
        url: `https://${platform}.com/x`,
        enabled: true,
      })),
    });
    expect(parsed.socialMedia).toHaveLength(7);
  });
});
