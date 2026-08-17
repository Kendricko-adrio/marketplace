import { z } from "zod";

/**
 * Static page schemas, shared by POST /api/admin/pages and
 * PATCH /api/admin/pages/{id}. Slug rules from docs/features/static-pages.md:
 * lowercase letters, digits, hyphens; max 60 chars.
 */
export const pageSlugSchema = z
  .string()
  .min(1, "Slug wajib diisi")
  .max(60, "Slug maksimal 60 karakter")
  .regex(
    /^[a-z0-9-]+$/,
    "Slug hanya boleh huruf kecil, angka, dan tanda hubung"
  );

export const createPageSchema = z.object({
  slug: pageSlugSchema,
  title: z.string().min(1, "Judul wajib diisi").max(200),
  content: z.string().default(""),
  isPublished: z.boolean().default(true),
  displayOrder: z.number().int().min(0).default(0),
});

export const updatePageSchema = z.object({
  slug: pageSlugSchema.optional(),
  title: z.string().min(1, "Judul wajib diisi").max(200).optional(),
  content: z.string().optional(),
  isPublished: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
});
