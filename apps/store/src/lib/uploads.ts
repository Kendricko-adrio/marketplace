import { unlink } from "fs/promises";
import path from "path";

export function getUploadsDir(): string {
  const env = process.env.UPLOADS_DIR;
  if (env && env.trim() !== "") return env;

  return path.resolve(process.cwd(), "..", "..", "public", "uploads");
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
