/**
 * Client-safe helpers for resolving image URLs against the storefront origin.
 * This module must NOT import any Node-only modules (fs, path, etc.) so it
 * can be bundled into Client Components.
 */

/**
 * Public base URL of the storefront app.
 * Admin displays images by pointing at the store origin so that uploaded
 * files (shared on disk between apps) are always served from the store URL
 * (e.g. http://localhost:3000) regardless of which app is rendering them.
 */
export function getStorePublicUrl(): string {
  const url = process.env.NEXT_PUBLIC_STORE_URL || "http://localhost:3000";
  return url.replace(/\/+$/, "");
}

/**
 * Turns a root-relative asset path (e.g. "/uploads/homepage/abc.jpg" or
 * "/images/products/shoes1.webp") into an absolute URL served by the store.
 * Absolute URLs (http/https/blob/data:) are returned unchanged.
 */
export function toStoreUrl(src: string | null | undefined): string {
  if (!src) return "";
  if (/^(https?:)?\/\//i.test(src) || src.startsWith("blob:") || src.startsWith("data:")) {
    return src;
  }
  return `${getStorePublicUrl()}${src.startsWith("/") ? "" : "/"}${src}`;
}