import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";
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

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("admin-upload");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari filesystem tidak
 * pernah masuk log.
 */
class UploadLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadLogError";
  }
}

// =========================================================
// POST /api/admin/upload — purpose-bound upload
// =========================================================
// Uploads are not a permission module. The requested folder must map to a
// validated owning purpose (products/homepage/orders → that module's edit
// authority); an unknown folder fails closed before authorization, and the
// write itself requires the owning module's edit grant from the Current
// Policy. A caller is NEVER authorized merely because they are
// authenticated.
async function uploadFile(request: NextRequest): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const folder = searchParams.get("folder") || "products";

  const purpose = uploadPurposeForFolder(folder);
  if (!purpose) {
    // Nilai `folder` dari klien tidak dicatat: hanya alasan penolakan.
    log.warn("upload.invalid_folder (reason unknown_folder_purpose, outcome denied)");
    return NextResponse.json(
      { success: false, error: "Invalid folder" },
      { status: 400 }
    );
  }

  const guardResult = await guard(purpose.module, purpose.action);
  if (!guardResult.ok) return guardResult.response;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      log.warn(`upload.missing_file (folder ${folder}, outcome denied)`);
      return NextResponse.json(
        { success: false, error: "No file provided" },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      // Tipe yang dikirim klien tidak dicatat sebagai nilai bebas; hanya folder
      // yang tervalidasi.
      log.warn(`upload.invalid_type (folder ${folder}, outcome denied)`);
      return NextResponse.json(
        { success: false, error: "Invalid file type. Allowed: JPEG, PNG, WebP, GIF" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      log.warn(`upload.too_large (folder ${folder}, outcome denied)`);
      return NextResponse.json(
        { success: false, error: "File too large. Max 5MB" },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const detected = detectImageType(buffer);
    if (!detected || detected.mime !== file.type) {
      log.warn(`upload.content_type_mismatch (folder ${folder}, outcome denied)`);
      return NextResponse.json(
        { success: false, error: "File content does not match an allowed image type" },
        { status: 400 }
      );
    }
    const filename = `${crypto.randomUUID()}.${detected.extension}`;
    await saveFile(folder, filename, buffer);

    const url = `/uploads/${folder}/${filename}`;
    log.info(
      `upload.stored (folder ${folder}, purpose ${purpose.module}.${purpose.action}, url ${url}, outcome success)`
    );
    return NextResponse.json({ success: true, url });
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat path filesystem.
    log.error(
      `upload.store gagal (folder ${folder}, outcome error)`,
      new UploadLogError("upload store gagal")
    );
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
async function deleteUploadedFile(request: NextRequest): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    log.warn("upload.delete.missing_url (outcome denied)");
    return NextResponse.json(
      { success: false, error: "Missing url param" },
      { status: 400 }
    );
  }

  const target = resolveUploadDeleteUrl(url);
  if (!target) {
    // Nilai `url` dari klien tidak dicatat: bisa memuat payload traversal/URL
    // bebas, hanya alasan penolakan yang masuk log.
    log.warn(
      "upload.delete.invalid_url (reason unknown_folder_purpose, outcome denied)"
    );
    return NextResponse.json(
      { success: false, error: "Invalid url" },
      { status: 400 }
    );
  }
  const purpose = target.purpose;

  const guardResult = await guard(purpose.module, purpose.action);
  if (!guardResult.ok) return guardResult.response;

  try {
    // Delete the canonicalized target, never the raw client URL.
    await deleteFile(target.url);

    log.info(
      `upload.deleted (purpose ${purpose.module}.${purpose.action}, url ${target.url}, outcome success)`
    );
    return NextResponse.json({ success: true });
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat path filesystem.
    log.error(
      `upload.delete gagal (url ${target.url}, outcome error)`,
      new UploadLogError("upload delete gagal")
    );
    return NextResponse.json(
      { success: false, error: "Failed to delete file" },
      { status: 500 }
    );
  }
}

/**
 * Multipart dibaca di dalam handler (`request.formData()`), bukan oleh wrapper:
 * `withRequestContext` hanya membungkus body sebagai referensi stream, jadi
 * upload/deleting tetap berjalan seperti sebelumnya.
 */
export const POST = withRequestContext(uploadFile, "admin-upload");
export const DELETE = withRequestContext(deleteUploadedFile, "admin-upload");
