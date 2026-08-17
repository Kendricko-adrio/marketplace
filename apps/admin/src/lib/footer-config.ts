import { z } from "zod";

/**
 * Footer config validation, shared by GET/PUT /api/admin/footer.
 * Limits from docs/features/footer.md: max 3 columns, max 5 links per
 * column, required brand/copyright, 7 fixed social platforms.
 */
export const footerConfigSchema = z.object({
  brandName: z.string().min(1, "Nama brand wajib diisi").max(100),
  tagline: z.string().max(300, "Tagline maksimal 300 karakter").default(""),
  copyrightText: z
    .string()
    .min(1, "Teks copyright wajib diisi")
    .max(200, "Copyright maksimal 200 karakter"),
  columns: z
    .array(
      z.object({
        title: z.string().min(1, "Judul kolom wajib diisi").max(100),
        links: z
          .array(
            z.object({
              label: z.string().min(1, "Label wajib diisi").max(100),
              href: z.string().min(1, "Link wajib diisi").max(500),
            })
          )
          .max(5, "Maksimal 5 link per kolom"),
      })
    )
    .max(3, "Maksimal 3 kolom")
    .default([]),
  socialMedia: z
    .array(
      z.object({
        platform: z.enum([
          "instagram",
          "facebook",
          "twitter",
          "tiktok",
          "youtube",
          "linkedin",
          "whatsapp",
        ]),
        url: z.string().max(500).default(""),
        enabled: z.boolean().default(false),
      })
    )
    .default([]),
});
