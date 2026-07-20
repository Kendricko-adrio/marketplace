import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./auth";

// Social platforms supported by the footer CMS.
// Each platform renders with a dedicated icon in the storefront footer.
export type SocialPlatform =
  | "instagram"
  | "facebook"
  | "twitter"
  | "tiktok"
  | "youtube"
  | "linkedin"
  | "whatsapp";

// A single link entry inside a footer column.
export interface FooterLink {
  label: string;
  href: string;
}

// A single column in the footer (e.g. "Layanan", "Tentang"). Max 5 links per column.
export interface FooterColumn {
  title: string;
  links: FooterLink[];
}

// A social media entry in the footer.
export interface SocialMediaLink {
  platform: SocialPlatform;
  url: string;
  enabled: boolean;
}

// Shape of the jsonb `data` column on `footerConfig`.
// The storefront renders this. Admin edits this via /admin/footer (HQ-only).
export interface FooterConfigData {
  brandName: string;
  tagline: string;
  columns: FooterColumn[]; // max 3
  copyrightText: string;
  socialMedia: SocialMediaLink[];
}

// Hardcoded fallback used by the storefront when the DB has no footer row
// (e.g. before seeding). Identical to the original hardcoded Footer.tsx so
// the storefront looks the same before/after migration.
export const DEFAULT_FOOTER_CONFIG: FooterConfigData = {
  brandName: "StoreFront",
  tagline:
    "Belanja aman, nyaman, dan terpercaya. Temukan produk terbaik dengan harga terbaik hanya di sini.",
  columns: [
    {
      title: "Layanan",
      links: [
        { label: "Bantuan", href: "/help" },
        { label: "Status Pesanan", href: "/status" },
        { label: "Katalog", href: "/catalog" },
        { label: "Cabang Kami", href: "/branches" },
      ],
    },
    {
      title: "Tentang",
      links: [
        { label: "Tentang Kami", href: "/pages/about" },
        { label: "Hubungi Kami", href: "/pages/contact" },
        { label: "Privasi", href: "/pages/privacy" },
        { label: "Syarat & Ketentuan", href: "/pages/terms" },
      ],
    },
  ],
  copyrightText: "© 2026 StoreFront. All rights reserved.",
  socialMedia: [],
};

// Footer config singleton table.
// There should only ever be one row (enforced in app code, not by the DB).
// The `data` column holds the full FooterConfigData as jsonb.
export const footerConfig = pgTable("footer_config", {
  id: text("id").primaryKey(),
  data: jsonb("data").notNull().default({}),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
});

export const footerConfigRelations = relations(footerConfig, ({ one }) => ({
  updatedByUser: one(users, {
    fields: [footerConfig.updatedBy],
    references: [users.id],
  }),
}));