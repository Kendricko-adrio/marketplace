import { writeFile, mkdir, unlink } from "fs/promises";
import path from "path";

export const ALLOWED_FOLDERS = ["products", "homepage", "orders"];
export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
export const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

export function detectImageType(
  buffer: Buffer
): { mime: string; extension: "jpg" | "png" | "webp" | "gif" } | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: "image/jpeg", extension: "jpg" };
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mime: "image/png", extension: "png" };
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { mime: "image/webp", extension: "webp" };
  }
  if (
    buffer.length >= 6 &&
    ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))
  ) {
    return { mime: "image/gif", extension: "gif" };
  }
  return null;
}

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
  const dir = path.join(/* turbopackIgnore: true */ getUploadsDir(), folder);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(/* turbopackIgnore: true */ dir, filename), buffer);
}

export async function deleteFile(fileUrl: string): Promise<void> {
  if (!fileUrl.startsWith("/uploads/")) return;

  const relativePath = fileUrl.replace("/uploads/", "");
  const root = path.resolve(/* turbopackIgnore: true */ getUploadsDir());
  const fullPath = path.resolve(/* turbopackIgnore: true */ root, relativePath);
  if (!fullPath.startsWith(`${root}${path.sep}`)) return;
  try {
    await unlink(/* turbopackIgnore: true */ fullPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
