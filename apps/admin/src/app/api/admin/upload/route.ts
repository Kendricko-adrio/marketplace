import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { guard } from "@/lib/rbac/guard";
import { createLogger, serializeError } from "@/lib/logger";
import {
  MAX_FILE_SIZE,
  ALLOWED_TYPES,
  detectImageType,
  saveFile,
  deleteFile,
} from "@/lib/uploads";
import {
  uploadPurposeForFolder,
  resolveUploadDeleteUrl,
} from "@/lib/rbac/upload-purposes";

// =========================================================
// POST /api/admin/upload — purpose-bound upload
// =========================================================
// Uploads are not a permission module. The requested folder must map to a
// validated owning purpose (products/homepage/orders → that module's edit
// authority); an unknown folder fails closed before authorization, and the
// write itself requires the owning module's edit grant from the Current
// Policy. A caller is NEVER authorized merely because they are
// authenticated.
export async function POST(request: NextRequest) {
  const preLogger = createLogger({ route: "upload" });

  const { searchParams } = new URL(request.url);
  const folder = searchParams.get("folder") || "products";

  const purpose = uploadPurposeForFolder(folder);
  if (!purpose) {
    preLogger.warn("upload.invalid_folder", {
      outcome: "denied",
      reason: "unknown_folder_purpose",
      folder,
    });
    return NextResponse.json(
      { success: false, error: "Invalid folder" },
      { status: 400 }
    );
  }

  const guardResult = await guard(purpose.module, purpose.action, { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger } = guardResult;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      logger.warn("upload.missing_file", { outcome: "denied", folder });
      return NextResponse.json(
        { success: false, error: "No file provided" },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      logger.warn("upload.invalid_type", { outcome: "denied", folder });
      return NextResponse.json(
        { success: false, error: "Invalid file type. Allowed: JPEG, PNG, WebP, GIF" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      logger.warn("upload.too_large", { outcome: "denied", folder });
      return NextResponse.json(
        { success: false, error: "File too large. Max 5MB" },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const detected = detectImageType(buffer);
    if (!detected || detected.mime !== file.type) {
      logger.warn("upload.content_type_mismatch", { outcome: "denied", folder });
      return NextResponse.json(
        { success: false, error: "File content does not match an allowed image type" },
        { status: 400 }
      );
    }
    const filename = `${crypto.randomUUID()}.${detected.extension}`;
    await saveFile(folder, filename, buffer);

    const url = `/uploads/${folder}/${filename}`;
    logger.info("upload.stored", {
      outcome: "success",
      folder,
      purpose: `${purpose.module}.${purpose.action}`,
      url,
    });
    return NextResponse.json({ success: true, url });
  } catch (error) {
    logger.error("upload.store.failure", {
      outcome: "error",
      folder,
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to upload file" },
      { status: 500 }
    );
  }
}

// =========================================================
// DELETE /api/admin/upload — purpose-bound delete
// =========================================================
// The URL is canonicalized and validated BEFORE deriving the purpose: the
// owning folder must be the folder the file is actually deleted from (no
// literal/encoded traversal, no resolved-path/purpose mismatch). Deleting
// requires the owning module's edit authority (the same authority that
// governs writing files there).
export async function DELETE(request: NextRequest) {
  const preLogger = createLogger({ route: "upload" });

  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    preLogger.warn("upload.delete.missing_url", { outcome: "denied" });
    return NextResponse.json(
      { success: false, error: "Missing url param" },
      { status: 400 }
    );
  }

  const target = resolveUploadDeleteUrl(url);
  if (!target) {
    preLogger.warn("upload.delete.invalid_url", {
      outcome: "denied",
      reason: "unknown_folder_purpose",
      url,
    });
    return NextResponse.json(
      { success: false, error: "Invalid url" },
      { status: 400 }
    );
  }
  const purpose = target.purpose;

  const guardResult = await guard(purpose.module, purpose.action, { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger } = guardResult;

  try {
    // Delete the canonicalized target, never the raw client URL.
    await deleteFile(target.url);

    logger.info("upload.deleted", {
      outcome: "success",
      purpose: `${purpose.module}.${purpose.action}`,
      url: target.url,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("upload.delete.failure", {
      outcome: "error",
      url: target.url,
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to delete file" },
      { status: 500 }
    );
  }
}