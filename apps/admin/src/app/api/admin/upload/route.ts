import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { withAuth } from "@/lib/auth-guard";
import {
  ALLOWED_FOLDERS,
  MAX_FILE_SIZE,
  ALLOWED_TYPES,
  saveFile,
  deleteFile,
} from "@/lib/uploads";

export const POST = withAuth(async (_ctx, request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const folder = searchParams.get("folder") || "products";

    if (!ALLOWED_FOLDERS.includes(folder)) {
      return NextResponse.json(
        { success: false, error: "Invalid folder" },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: "No file provided" },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: "Invalid file type. Allowed: JPEG, PNG, WebP, GIF" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: "File too large. Max 5MB" },
        { status: 400 }
      );
    }

    const ext = file.name.split(".").pop() || "jpg";
    const filename = `${crypto.randomUUID()}.${ext}`;

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await saveFile(folder, filename, buffer);

    return NextResponse.json({
      success: true,
      url: `/uploads/${folder}/${filename}`,
    });
  } catch (error) {
    console.error("Error uploading file:", error);
    return NextResponse.json(
      { success: false, error: "Failed to upload file" },
      { status: 500 }
    );
  }
}, ["admin", "hq"]);

export const DELETE = withAuth(async (_ctx, request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url");

    if (!url) {
      return NextResponse.json(
        { success: false, error: "Missing url param" },
        { status: 400 }
      );
    }

    await deleteFile(url);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting file:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete file" },
      { status: 500 }
    );
  }
}, ["admin", "hq"]);