import type { ActionKey, ModuleKey } from "@marketplace/db/src/rbac/catalog";
import path from "path";

// =========================================================
// RBAC: purpose-bound upload authorization (pure map)
// =========================================================
// Uploads are not a standalone permission module. Upload/delete
// authorization follows the validated owning purpose/folder: each allowed
// upload folder maps to the module/action whose edit authority governs
// writing (and deleting) files there. An unknown folder maps to no purpose
// and the upload route must fail closed — a caller is NEVER authorized
// merely because they are authenticated.
//
// Scope is enforced by the catalog: `products.edit` only supports
// `all_branches` (global Jubelio master-data change), so a branch-scoped
// editor cannot upload product images; `homepage` and `orders` follow the
// caller's own edit scope.

export interface UploadPurpose {
  module: ModuleKey;
  action: ActionKey;
}

/** Allowed upload folders → owning module/action (purpose-bound). */
export const UPLOAD_FOLDER_PURPOSES: Readonly<
  Record<string, UploadPurpose>
> = {
  products: { module: "products", action: "edit" },
  homepage: { module: "homepage", action: "edit" },
  orders: { module: "orders", action: "edit" },
};

/**
 * Resolve the owning purpose for an upload folder. Returns null for any
 * folder that is not a validated purpose (deny).
 */
export function uploadPurposeForFolder(folder: string): UploadPurpose | null {
  return UPLOAD_FOLDER_PURPOSES[folder] ?? null;
}

/**
 * Resolve the owning purpose from a stored file URL such as
 * `/uploads/products/abc.png`. Only URLs under `/uploads/<known-folder>/`
 * map to a purpose. The URL is canonicalized/validated first, so a URL
 * whose first segment names one folder while the resolved path lands in
 * another (e.g. `/uploads/products/../homepage/x`) maps to no purpose.
 */
export function uploadPurposeForDeleteUrl(url: string): UploadPurpose | null {
  return resolveUploadDeleteUrl(url)?.purpose ?? null;
}

export interface UploadDeleteTarget {
  purpose: UploadPurpose;
  /** Canonical (decoded) URL path, safe to hand to deleteFile. */
  url: string;
}

/**
 * Canonicalize and validate a delete URL before deriving its purpose.
 *
 * The purpose must match the folder the file is actually deleted from, not
 * merely the URL's first raw segment: `/uploads/products/../homepage/x`
 * resolves to `/uploads/homepage/x`, so authorizing it as `products.edit`
 * would let a products editor delete homepage assets. This function
 * decodes percent-encoding once, then rejects traversal (literal or
 * encoded `..`/`.` dot segments), encoded separators (`%2F`, `%5C`),
 * backslashes, NUL bytes, and malformed encoding — and finally verifies
 * that the resolved path stays under `/uploads/<first-segment>/`. Returns
 * null (deny) for anything that does not cleanly resolve to a supported
 * purpose folder.
 */
export function resolveUploadDeleteUrl(url: string): UploadDeleteTarget | null {
  const PREFIX = "/uploads/";
  if (typeof url !== "string" || !url.startsWith(PREFIX)) return null;

  const rest = url.slice(PREFIX.length);
  if (rest.length === 0 || rest.endsWith("/")) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    // Malformed percent-encoding: fail closed.
    return null;
  }
  // Decode until stable (bounded) so double-encoded payloads such as
  // `%252e%252e` → `%2e%2e` → `..` cannot smuggle traversal past one pass.
  for (let i = 0; i < 3; i++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return null;
    }
    if (next === decoded) break;
    if (i === 2) return null; // still unstable after bounded passes: deny
    decoded = next;
  }
  if (decoded.includes("\\") || decoded.includes("\0")) return null;

  const segments = decoded.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    return null;
  }

  const [folder] = segments;
  const purpose = uploadPurposeForFolder(folder);
  if (!purpose) return null;

  // Defense in depth: the resolved path must stay inside the named folder.
  const resolved = path.posix.resolve(PREFIX, decoded);
  if (!resolved.startsWith(`${PREFIX}${folder}/`)) return null;

  return { purpose, url: `${PREFIX}${decoded}` };
}