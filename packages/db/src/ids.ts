/**
 * ids — shared deterministic-id + slug helpers.
 *
 * Extracted from the former SOH sync module (soh-sync.ts) so the seeder and
 * other tooling can keep producing stable IDs without depending on the
 * (now removed) SOH import/webhook logic. Jubelio sync keeps its own copies
 * (jubelio-sync.ts) with a "jubelio:" prefix.
 */

import { createHash } from "node:crypto";

export function slugify(v: string): string {
  return (v || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Deterministic, collision-safe id for a natural key (sha1, 96-bit prefix). */
export function keyId(prefix: string, key: string): string {
  return (
    prefix + createHash("sha1").update(key, "utf8").digest("hex").slice(0, 24)
  );
}
