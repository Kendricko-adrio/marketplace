import { describe, it, expect } from "vitest";
import { createPageSchema, updatePageSchema, pageSlugSchema } from "./static-pages";

// Backs POST /api/admin/pages and PATCH /api/admin/pages/{id} validation.
describe("pageSlugSchema", () => {
  it("accepts lowercase slugs with digits and hyphens", () => {
    expect(pageSlugSchema.parse("tentang-kami")).toBe("tentang-kami");
    expect(pageSlugSchema.parse("syarat-2026")).toBe("syarat-2026");
  });

  it("rejects uppercase letters", () => {
    expect(() => pageSlugSchema.parse("Tentang")).toThrow();
  });

  it("rejects spaces and special characters", () => {
    expect(() => pageSlugSchema.parse("tentang kami")).toThrow();
    expect(() => pageSlugSchema.parse("tentang_kami")).toThrow();
    expect(() => pageSlugSchema.parse("tentang.kami")).toThrow();
  });

  it("rejects slugs longer than 60 characters", () => {
    expect(() => pageSlugSchema.parse("a".repeat(61))).toThrow();
    expect(pageSlugSchema.parse("a".repeat(60))).toBe("a".repeat(60));
  });

  it("rejects an empty slug", () => {
    expect(() => pageSlugSchema.parse("")).toThrow();
  });
});

describe("createPageSchema", () => {
  it("defaults content, isPublished, and displayOrder", () => {
    const parsed = createPageSchema.parse({ slug: "about", title: "Tentang" });
    expect(parsed.content).toBe("");
    expect(parsed.isPublished).toBe(true);
    expect(parsed.displayOrder).toBe(0);
  });

  it("rejects a missing title", () => {
    expect(() => createPageSchema.parse({ slug: "about" })).toThrow();
  });
});

describe("updatePageSchema", () => {
  it("accepts a partial update", () => {
    const parsed = updatePageSchema.parse({ title: "Baru" });
    expect(parsed.title).toBe("Baru");
    expect(parsed.slug).toBeUndefined();
  });

  it("still validates the slug when provided", () => {
    expect(() => updatePageSchema.parse({ slug: "BAD SLUG" })).toThrow();
  });
});
