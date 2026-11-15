import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  guardAllow,
  guardMock,
  type RouteModuleLogger,
} from "@/test-support/route-test";
import { deleteFile } from "@/lib/uploads";

// =========================================================
// Regression: purpose-bound DELETE /api/admin/upload
// =========================================================
// The stored URL's owning folder must be canonicalized and validated BEFORE
// deriving the purpose and deleting: `/uploads/products/../homepage/x` must
// never be authorized as `products.edit` and then delete a homepage file.
// A products editor must not be able to reach homepage (or any other
// purpose) files through literal or encoded traversal in the url param.
//
// Logging: the route uses one module-scoped facade logger, so assertions read
// the SAME stub the module created and the business facts travel in the
// `message` (the facade has no free business fields).

/**
 * Stub module logger yang dipakai route. `vi.hoisted` menjaga container ini
 * sudah ada saat factory mock dievaluasi (import `./route` berjalan lebih dulu
 * daripada body file test).
 */
const captured = vi.hoisted(() => ({
  moduleLog: null as RouteModuleLogger | null,
}));

vi.mock("@/lib/rbac/guard", async () => {
  const helpers = await import("@/test-support/route-test");
  return {
    guard: helpers.guardMock,
    crossBranchNotFound: helpers.crossBranchNotFound,
  };
});

vi.mock("@/lib/logger", async () => {
  const helpers = await import("@/test-support/route-test");
  const shared = helpers.makeModuleLogger();
  captured.moduleLog = shared;
  return {
    ...(await helpers.loggerModuleMock()),
    createModuleLogger: () => shared,
  };
});

vi.mock("@/lib/uploads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/uploads")>();
  return {
    ...actual,
    deleteFile: vi.fn(async () => {}),
  };
});

import { DELETE } from "./route";

/** Stub module logger milik route (dibuat saat `./route` diimpor). */
function moduleLog(): RouteModuleLogger {
  const value = captured.moduleLog;
  if (!value) throw new Error("module logger route belum dibuat");
  return value;
}

function deleteRequest(url: string): NextRequest {
  const params = new URLSearchParams();
  params.set("url", url);
  return new NextRequest(
    `http://localhost:3001/api/admin/upload?${params.toString()}`,
    { method: "DELETE" }
  );
}

beforeEach(() => {
  guardMock.mockReset();
  guardAllow();
  moduleLog().info.mockClear();
  moduleLog().warn.mockClear();
  moduleLog().error.mockClear();
  vi.mocked(deleteFile).mockClear();
});

describe("DELETE /api/admin/upload (purpose-bound)", () => {
  it("deletes a file under a supported purpose folder", async () => {
    const response = await DELETE(deleteRequest("/uploads/products/abc.png"));

    expect(response.status).toBe(200);
    expect(deleteFile).toHaveBeenCalledWith("/uploads/products/abc.png");
    // Authorization stays pinned to the folder's owning module — no request
    // object is threaded into the guard any more.
    expect(guardMock).toHaveBeenCalledWith("products", "edit");
    expect(guardMock).toHaveBeenCalledTimes(1);
    // The success event carries the canonical internal path in its message.
    expect(moduleLog().info).toHaveBeenCalledWith(
      expect.stringContaining(
        "upload.deleted (purpose products.edit, url /uploads/products/abc.png, outcome success)"
      )
    );
  });

  it("rejects literal traversal instead of authorizing one folder and deleting another", async () => {
    // First segment says `products`, the resolved path is under `homepage/`.
    const response = await DELETE(
      deleteRequest("/uploads/products/../homepage/x.webp")
    );

    expect(response.status).toBe(400);
    expect(deleteFile).not.toHaveBeenCalled();
    // The raw client URL is never written to the log.
    expect(moduleLog().warn).toHaveBeenCalledWith(
      "upload.delete.invalid_url (reason unknown_folder_purpose, outcome denied)"
    );
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
    expect(guardMock).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
  });
});
