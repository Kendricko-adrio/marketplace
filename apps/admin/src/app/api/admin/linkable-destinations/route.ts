import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { staticPages } from "@/db";
import { eq, asc } from "drizzle-orm";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("admin-linkable-destinations");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/driver tidak
 * pernah masuk log.
 */
class LinkableDestinationsLogError extends Error {
  constructor() {
    super("linkable destinations gagal");
    this.name = "LinkableDestinationsLogError";
  }
}

// -----------------------------
// GET /api/admin/linkable-destinations [footer:view]
// Link destination reads follow the Footer module: the picker only feeds
// footer links, so the Footer view grant governs the read. Returns
// categorized lists of storefront destinations that can be used as footer
// link hrefs. Consumed by FooterLinkPicker.
// -----------------------------

interface LinkableDestination {
  label: string;
  href: string;
}

// Static storefront routes that are relevant as footer links.
// Only routes that actually exist in apps/store/src/app/ are included
// (verified via glob). Auth-gated routes (/cart, /checkout, /account)
// are safe to link — the storefront middleware redirects unauthenticated
// users to /login with a callbackUrl, so the link works for both
// logged-in customers (directly) and guests (via login redirect).
const STATIC_ROUTES: LinkableDestination[] = [
  { label: "Beranda", href: "/" },
  { label: "Semua Produk", href: "/products" },
  { label: "Cabang", href: "/branches" },
  { label: "Keranjang Belanja", href: "/cart" },
  { label: "Checkout", href: "/checkout" },
  { label: "Akun Saya", href: "/account" },
  { label: "Masuk", href: "/login" },
  { label: "Daftar", href: "/register" },
];

async function listLinkableDestinations(
  _request: NextRequest
): Promise<Response> {
  const guardResult = await guard("footer", "view");
  if (!guardResult.ok) return guardResult.response;

  try {
    // Fetch published static pages, ordered by displayOrder then title.
    const pageRows = await db
      .select({
        slug: staticPages.slug,
        title: staticPages.title,
        displayOrder: staticPages.displayOrder,
      })
      .from(staticPages)
      .where(eq(staticPages.isPublished, true))
      .orderBy(asc(staticPages.displayOrder), asc(staticPages.title));

    const pages: LinkableDestination[] = pageRows.map((p) => ({
      label: p.title,
      href: `/pages/${p.slug}`,
    }));

    log.info(
      `linkable_destinations.get (pageCount ${pages.length}, staticCount ${STATIC_ROUTES.length}, outcome success)`
    );
    return NextResponse.json({
      success: true,
      data: {
        pages,
        static: STATIC_ROUTES,
      },
    });
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat SQL/nilai baris.
    log.error(
      "linkable_destinations.get gagal (outcome error)",
      new LinkableDestinationsLogError()
    );
    return NextResponse.json(
      { success: false, error: "Failed to fetch linkable destinations" },
      { status: 500 }
    );
  }
}

export const GET = withRequestContext(
  listLinkableDestinations,
  "admin-linkable-destinations"
);
