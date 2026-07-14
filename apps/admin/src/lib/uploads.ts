import { writeFile, mkdir, unlink } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

export const ALLOWED_FOLDERS = ["products", "homepage", "orders"];
export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
export const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

/**
 * Resolves the shared uploads directory.
 * Priority: UPLOADS_DIR env var → fallback to {repo_root}/public/uploads.
 *
 * In dev, both apps point at the same folder so admin uploads
 * are immediately visible to the store.
 * In prod, set UPLOADS_DIR to a shared volume / CDN mount.
 */
export function getUploadsDir(): string {
  const env = process.env.UPLOADS_DIR;
  if (env && env.trim() !== "") return env;

  // {app}/src/lib/uploads.ts → walk up to repo root, then /public/uploads.
  // Using __dirname would be unreliable in turbopack bundles, so derive
  // from cwd: when running `next dev`/`next build`, cwd is the app dir.
  return path.resolve(process.cwd(), "..", "..", "public", "uploads");
}

export async function saveFile(folder: string, filename: string, buffer: Buffer): Promise<void> {
  const dir = path.join(getUploadsDir(), folder);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), buffer);
}

export async function deleteFile(fileUrl: string): Promise<void> {
  if (!fileUrl.startsWith("/uploads/")) return;

  const relativePath = fileUrl.replace("/uploads/", "");
  if (relativePath.includes("..")) return; // prevent path traversal

  const fullPath = path.join(getUploadsDir(), relativePath);
  if (existsSync(fullPath)) {
    await unlink(fullPath);
  }
}