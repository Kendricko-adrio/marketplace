import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { deleteFile, ALLOWED_FOLDERS, MAX_FILE_SIZE } from "./uploads";

// Backs POST/DELETE /api/admin/upload guards.
describe("uploads constants", () => {
  it("allows only the documented folders", () => {
    expect(ALLOWED_FOLDERS).toEqual(["products", "homepage", "orders"]);
  });

  it("caps file size at 5 MB", () => {
    expect(MAX_FILE_SIZE).toBe(5 * 1024 * 1024);
  });
});

describe("deleteFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "uploads-test-"));
    process.env.UPLOADS_DIR = dir;
  });

  afterEach(() => {
    delete process.env.UPLOADS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("deletes a file under /uploads/", async () => {
    const file = path.join(dir, "products", "abc.png");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "x");
    expect(existsSync(file)).toBe(true);

    await deleteFile("/uploads/products/abc.png");
    expect(existsSync(file)).toBe(false);
  });

  it("is a no-op for non-/uploads/ URLs", async () => {
    const file = path.join(dir, "keep.txt");
    writeFileSync(file, "x");
    await deleteFile("/etc/passwd");
    expect(existsSync(file)).toBe(true);
  });

  it("refuses path traversal (..)", async () => {
    const outside = path.join(dir, "..", "should-not-delete.txt");
    writeFileSync(outside, "x");
    await deleteFile("/uploads/../../should-not-delete.txt");
    expect(existsSync(outside)).toBe(true);
  });

  it("is a no-op when the file does not exist", async () => {
    await expect(deleteFile("/uploads/products/missing.png")).resolves.toBeUndefined();
  });
});
