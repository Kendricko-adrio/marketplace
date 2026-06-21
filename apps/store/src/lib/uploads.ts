import { writeFile, mkdir, unlink } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

export function getUploadsDir(): string {
  const env = process.env.UPLOADS_DIR;
  if (env && env.trim() !== "") return env;

  return path.resolve(process.cwd(), "..", "..", "public", "uploads");
}

export async function deleteFile(fileUrl: string): Promise<void> {
  if (!fileUrl.startsWith("/uploads/")) return;

  const relativePath = fileUrl.replace("/uploads/", "");
  if (relativePath.includes("..")) return;

  const fullPath = path.join(getUploadsDir(), relativePath);
  if (existsSync(fullPath)) {
    await unlink(fullPath);
  }
}