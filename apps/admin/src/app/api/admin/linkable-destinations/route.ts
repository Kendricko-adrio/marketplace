import { NextResponse } from "next/server";
import { db } from "@/db";
import { staticPages } from "@/db";
import { eq, asc } from "drizzle-orm";
import { withAuth } from "@/lib/auth-guard";

// -----------------------------
// GET /api/admin/linkable-destinations — HQ only
// Returns categorized lists of storefront destinations that can be used
// as footer link hrefs. Consumed by FooterLinkPicker.
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

export const GET = withAuth(async () => {
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

    return NextResponse.json({
      success: true,
      data: {
        pages,
        static: STATIC_ROUTES,
      },
    });
  } catch (error) {
    console.error("Error fetching linkable destinations:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch linkable destinations" },
      { status: 500 }
    );
  }
}, ["hq"]);