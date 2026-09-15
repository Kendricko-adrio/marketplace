import { describe, expect, it } from "vitest";

import {
  UPLOAD_FOLDER_PURPOSES,
  uploadPurposeForFolder,
  uploadPurposeForDeleteUrl,
  resolveUploadDeleteUrl,
} from "./upload-purposes";

// =========================================================
// RBAC: purpose-bound upload authorization (pure seam)
// =========================================================
// Uploads are NOT a permission module. Every upload/delete is authorized
// through the validated owning purpose/folder: the folder maps to the
// module/action whose edit authority governs the upload. An unknown folder
// maps to no purpose and must fail closed.
describe("upload purpose map", () => {
  it("maps every allowed folder to its owning module edit action", () => {
    expect(uploadPurposeForFolder("products")).toEqual({
      module: "products",
      action: "edit",
    });
    expect(uploadPurposeForFolder("homepage")).toEqual({
      module: "homepage",
      action: "edit",
    });
    expect(uploadPurposeForFolder("orders")).toEqual({
      module: "orders",
      action: "edit",
    });
  });

  it("denies unknown and empty folders (fail closed)", () => {
    expect(uploadPurposeForFolder("unknown")).toBeNull();
    expect(uploadPurposeForFolder("")).toBeNull();
    expect(uploadPurposeForFolder("../etc")).toBeNull();
    expect(uploadPurposeForFolder("Products")).toBeNull();
  });

  it("exposes the allowed folders exactly as the purpose keys", () => {
    expect(Object.keys(UPLOAD_FOLDER_PURPOSES).sort()).toEqual([
      "homepage",
      "orders",
      "products",
    ]);
  });

  it("resolves the owning purpose from a delete URL path", () => {
    expect(uploadPurposeForDeleteUrl("/uploads/products/abc.png")).toEqual({
      module: "products",
      action: "edit",
    });
    expect(uploadPurposeForDeleteUrl("/uploads/homepage/x.webp")).toEqual({
      module: "homepage",
      action: "edit",
    });
  });

  it("denies delete URLs outside a known uploads folder", () => {
    expect(uploadPurposeForDeleteUrl("/uploads/unknown/x.png")).toBeNull();
    expect(uploadPurposeForDeleteUrl("/uploads/x.png")).toBeNull();
    expect(uploadPurposeForDeleteUrl("/static/products/x.png")).toBeNull();
    expect(uploadPurposeForDeleteUrl("not-a-url")).toBeNull();
  });

  // The delete URL must authorize the folder it actually deletes from, not
  // merely its first segment: `/uploads/products/../homepage/x` resolves to
  // `/uploads/homepage/x`, so authorizing it as `products.edit` would let a
  // products editor delete homepage assets.
  it("denies delete URLs that traverse out of the named folder", () => {
    expect(uploadPurposeForDeleteUrl("/uploads/products/../homepage/x.webp")).toBeNull();
    expect(uploadPurposeForDeleteUrl("/uploads/homepage/../../products/x.png")).toBeNull();
    expect(uploadPurposeForDeleteUrl("/uploads/products/sub/../x.png")).toBeNull();
  });

  it("denies encoded traversal and encoded separators in delete URLs", () => {
    expect(uploadPurposeForDeleteUrl("/uploads/products/%2e%2e/homepage/x.webp")).toBeNull();
    expect(uploadPurposeForDeleteUrl("/uploads/products/%2E%2E/homepage/x.webp")).toBeNull();
    expect(uploadPurposeForDeleteUrl("/uploads/products/x%2f..%2fhomepage/y.webp")).toBeNull();
    expect(uploadPurposeForDeleteUrl("/uploads/products/..%5Chomepage/x.webp")).toBeNull();
  });
});

describe("resolveUploadDeleteUrl", () => {
  it("returns the owning purpose and canonical URL for a valid delete URL", () => {
    expect(resolveUploadDeleteUrl("/uploads/products/abc.png")).toEqual({
      purpose: { module: "products", action: "edit" },
      url: "/uploads/products/abc.png",
    });
    expect(resolveUploadDeleteUrl("/uploads/homepage/hero.webp")).toEqual({
      purpose: { module: "homepage", action: "edit" },
      url: "/uploads/homepage/hero.webp",
    });
  });

  it("keeps a nested path inside its own folder purpose", () => {
    expect(resolveUploadDeleteUrl("/uploads/homepage/products/x.webp")).toEqual({
      purpose: { module: "homepage", action: "edit" },
      url: "/uploads/homepage/products/x.webp",
    });
  });

  it("decodes percent-encoded file names into the canonical URL", () => {
    expect(resolveUploadDeleteUrl("/uploads/products/a%20b.png")).toEqual({
      purpose: { module: "products", action: "edit" },
      url: "/uploads/products/a b.png",
    });
  });

  it("rejects literal traversal so the purpose matches the real target", () => {
    expect(resolveUploadDeleteUrl("/uploads/products/../homepage/x.webp")).toBeNull();
    expect(resolveUploadDeleteUrl("/uploads/products/../../public/uploads/homepage/x.webp")).toBeNull();
  });

  it("rejects encoded traversal and encoded separators", () => {
    expect(resolveUploadDeleteUrl("/uploads/products/%2e%2e/homepage/x.webp")).toBeNull();
    expect(resolveUploadDeleteUrl("/uploads/products/%2e%2e%2fhomepage%2fx.webp")).toBeNull();
    expect(resolveUploadDeleteUrl("/uploads/products%2F..%2Fhomepage/x.webp")).toBeNull();
    expect(resolveUploadDeleteUrl("/uploads/products/%5C..%5Chomepage/x.webp")).toBeNull();
    expect(resolveUploadDeleteUrl("/uploads/products/a%00b.png")).toBeNull();
  });

  it("rejects double-encoded traversal", () => {
    expect(resolveUploadDeleteUrl("/uploads/products/%252e%252e/homepage/x.webp")).toBeNull();
    expect(resolveUploadDeleteUrl("/uploads/products/%252F..%252Fhomepage/x.webp")).toBeNull();
  });

  it("rejects dot segments, empty segments, and trailing slashes", () => {
    expect(resolveUploadDeleteUrl("/uploads/products/./x.png")).toBeNull();
    expect(resolveUploadDeleteUrl("/uploads/products//x.png")).toBeNull();
    expect(resolveUploadDeleteUrl("/uploads/products/x/")).toBeNull();
  });

  it("rejects malformed percent-encoding", () => {
    expect(resolveUploadDeleteUrl("/uploads/products/a%zz.png")).toBeNull();
    expect(resolveUploadDeleteUrl("/uploads/products/a%2.png")).toBeNull();
  });

  it("rejects URLs outside a supported purpose folder", () => {
    expect(resolveUploadDeleteUrl("/uploads/unknown/x.png")).toBeNull();
    expect(resolveUploadDeleteUrl("/uploads/x.png")).toBeNull();
    expect(resolveUploadDeleteUrl("/uploads/")).toBeNull();
    expect(resolveUploadDeleteUrl("not-a-url")).toBeNull();
  });
});