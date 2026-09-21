import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { guard } from "@/lib/rbac/guard";
import { deleteFile } from "@/lib/uploads";

import { DELETE } from "./route";

// =========================================================
// Regression: purpose-bound DELETE /api/admin/upload
// =========================================================
// The stored URL's owning folder must be canonicalized and validated BEFORE
// deriving the purpose and deleting: `/uploads/products/../homepage/x` must
// never be authorized as `products.edit` and then delete a homepage file.
// A products editor must not be able to reach homepage (or any other
// purpose) files through literal or encoded traversal in the url param.

const { testLogger } = vi.hoisted(() => {
  const log = () => {};
  const logger = {
    requestId: "test",
    debug: log,
    info: log,
    warn: log,
    error: log,
    child: () => logger,
  };
  return { testLogger: logger };
});

vi.mock("@/lib/rbac/guard", () => ({
  guard: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  testLogger: {
    requestId: "test",
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => testLogger),
  },
  createLogger: () => testLogger,
  requestLogger: () => testLogger,
  serializeError: (error: unknown) => ({ message: String(error) }),
}));

vi.mock("@/lib/uploads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/uploads")>();
  return {
    ...actual,
    deleteFile: vi.fn(async () => {}),
  };
});

function deleteRequest(url: string): NextRequest {
  const params = new URLSearchParams();
  params.set("url", url);
  return new NextRequest(
    `http://localhost:3001/api/admin/upload?${params.toString()}`,
    { method: "DELETE" }
  );
}

beforeEach(() => {
  vi.mocked(guard).mockReset();
  vi.mocked(guard).mockResolvedValue({
    ok: true,
    ctx: {
      user: { id: "u1" } as never,
      policy: {} as never,
      authorization: { allowed: true, scope: "all_branches" } as never,
    },
    logger: testLogger,
  });
  vi.mocked(deleteFile).mockClear();
});

describe("DELETE /api/admin/upload (purpose-bound)", () => {
  it("deletes a file under a supported purpose folder", async () => {
    const response = await DELETE(deleteRequest("/uploads/products/abc.png"));

    expect(response.status).toBe(200);
    expect(deleteFile).toHaveBeenCalledWith("/uploads/products/abc.png");
    expect(guard).toHaveBeenCalledWith("products", "edit", expect.anything());
  });

  it("rejects literal traversal instead of authorizing one folder and deleting another", async () => {
    // First segment says `products`, the resolved path is under `homepage/`.
    const response = await DELETE(
      deleteRequest("/uploads/products/../homepage/x.webp")
    );

    expect(response.status).toBe(400);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("rejects percent-encoded traversal", async () => {
    const response = await DELETE(
      deleteRequest("/uploads/products/%2e%2e/homepage/x.webp")
    );

    expect(response.status).toBe(400);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("rejects double-encoded traversal", async () => {
    const response = await DELETE(
      deleteRequest("/uploads/products/%252e%252e/homepage/x.webp")
    );

    expect(response.status).toBe(400);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("rejects encoded separators that would smuggle a different folder", async () => {
    const response = await DELETE(
      deleteRequest("/uploads/products%2F..%2Fhomepage/x.webp")
    );

    expect(response.status).toBe(400);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("rejects backslash-based traversal", async () => {
    const response = await DELETE(
      deleteRequest("/uploads/products/..\\homepage/x.webp")
    );

    expect(response.status).toBe(400);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("rejects URLs under an unsupported folder before authorization", async () => {
    const response = await DELETE(deleteRequest("/uploads/unknown/x.png"));

    expect(response.status).toBe(400);
    expect(guard).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
  });
});