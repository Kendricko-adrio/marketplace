import { NextResponse } from "next/server";
import { db } from "@/db";
import { categories } from "@/db";
import { eq, asc } from "drizzle-orm";
import { createModuleLogger, withRequestContext } from "@/lib/logger";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("categories-route");

/**
 * HTTP adapter: baca kategori aktif, lalu map ke status/body yang sudah ada.
 * Query sengaja tetap di sini — perubahan ini logging-only.
 */
async function getCategories(): Promise<Response> {
  try {
    const allCategories = await db
      .select()
      .from(categories)
      .where(eq(categories.isActive, true))
      .orderBy(asc(categories.name));

    // Data bisnis (jumlah kategori) hanya ada di message, bukan field log.
    log.info(`Kategori aktif dimuat: ${allCategories.length}`);

    return NextResponse.json({
      success: true,
      data: allCategories,
    });
  } catch (error) {
    log.error("Kategori gagal dimuat", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch categories" },
      { status: 500 }
    );
  }
}

/**
 * GET tanpa argumen di source; framework tetap memanggilnya dengan request
 * runtime, yang diteruskan apa adanya oleh wrapper (`x-request-id` + completion
 * HTTP ditambahkan di sana).
 */
export const GET = withRequestContext(getCategories, "categories-route");
