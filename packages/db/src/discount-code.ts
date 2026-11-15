/**
 * Seam L — Manual Promo Code kanonik (ticket 09, spec §7.1).
 *
 * Modul ini PURE: tidak membaca DB/HTTP/config dan tidak pernah menulis apa
 * pun. Dipakai bersama oleh administrasi (reservasi canonical), store
 * (resolusi kode dari customer), dan masking viewer, sehingga hanya ada SATU
 * definisi bentuk kode yang sah.
 *
 * Aturan canonical (spec §7.1):
 * - trim spasi di tepi lalu uppercase;
 * - ASCII 3–64 karakter;
 * - karakter pertama alfanumerik, sisanya alfanumerik/underscore/hyphen.
 *
 * Alias Unicode DITOLAK sebelum uppercase: `"ı".toUpperCase()` menjadi `"I"`,
 * sehingga validasi harus melihat literal mentah agar dua penulisan berbeda
 * tidak pernah bertabrakan pada satu canonical code (exact canonical
 * uniqueness).
 */

export const PROMO_CODE_MIN_LENGTH = 3;
export const PROMO_CODE_MAX_LENGTH = 64;

/** Raw literal that may be canonicalized (ASCII only, before uppercase). */
const RAW_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
/** Stored canonical form (spec CHECK constraint mirror). */
export const CANONICAL_PROMO_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,63}$/;

/**
 * Bentuk baku sebuah kode. `null` berarti input tidak pernah sah — bukan
 * "kode tidak ditemukan": pemanggil wajib memakai reason aman yang sama untuk
 * keduanya agar tidak ada code discovery.
 */
export function canonicalizePromoCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length < PROMO_CODE_MIN_LENGTH) return null;
  if (trimmed.length > PROMO_CODE_MAX_LENGTH) return null;
  if (!RAW_CODE_PATTERN.test(trimmed)) return null;
  const canonical = trimmed.toUpperCase();
  return CANONICAL_PROMO_CODE_PATTERN.test(canonical) ? canonical : null;
}

/** True bila `value` sudah persis bentuk canonical (dipakai guard admin). */
export function isCanonicalPromoCode(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_PROMO_CODE_PATTERN.test(value);
}

const MASK_BULLET = "\u2022";
const FULLY_MASKED = MASK_BULLET.repeat(4);

/**
 * Label masked untuk viewer/history/audit/API non-editor: hanya prefix dan
 * suffix 2 karakter kode panjang, sisa disamarkan. Kode pendek disamarkan
 * seluruhnya. Masking deterministik supaya baris yang sama selalu tampil sama,
 * dan TIDAK PERNAH mengembalikan literal lengkap.
 */
export function maskPromoCode(value: unknown): string {
  if (typeof value !== "string") return FULLY_MASKED;
  const canonical = canonicalizePromoCode(value) ?? value.trim().toUpperCase();
  if (canonical.length < 8) return FULLY_MASKED;
  const bullets = MASK_BULLET.repeat(Math.max(4, canonical.length - 4));
  return `${canonical.slice(0, 2)}${bullets}${canonical.slice(-2)}`;
}
