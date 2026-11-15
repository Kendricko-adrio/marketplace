/**
 * Helper kontras warna untuk spec E2E yang mengunci tone visual kontrol form.
 *
 * Nilai dibaca dari hasil render NYATA (`getComputedStyle`), bukan dari string
 * class Tailwind. Jadi spec menguji tone yang dilihat pengguna — bukan
 * mengulang implementasi di assertion (sumber kebenaran: rumus kontras WCAG
 * 2.x di bawah, dengan angka ambang yang ditetapkan di spec, bukan dihitung
 * oleh kode yang diuji).
 *
 * Batasan yang disengaja: hanya warna OPAQUE. Token field (`--field`,
 * `--placeholder`, `--foreground`) semuanya opak; warna semi-transparan
 * (mis. `placeholder:text-white/45` di header gelap) akan ditolak dengan error
 * jelas alih-alih menghasilkan rasio yang salah tanpa compositing.
 */
import type { Locator } from "@playwright/test";

export type Rgb = readonly [number, number, number];

/**
 * Band tone placeholder yang disepakati (kontras vs permukaan field).
 * Batas atas mencegah regresi ke ≈7,7:1 (dulu memakai `--muted-foreground`,
 * sehingga field kosong terbaca seperti field terisi); batas bawah menjaga
 * prompt tetap terbaca. Nilai saat ini: ≈3,6:1 (light) dan ≈3,6:1 (dark).
 */
export const FAINT_PLACEHOLDER_MIN = 2.6;
export const FAINT_PLACEHOLDER_MAX = 4;

/** Teks nilai asli harus tetap jauh lebih kuat daripada prompt. */
export const VALUE_MIN_CONTRAST = 12;

/** `rgb(r, g, b)` / `rgba(r, g, b, a)` → channel 0-255. Menolak alpha < 1. */
export function parseRgb(css: string): Rgb {
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(
    css.trim()
  );
  if (!match) throw new Error(`Warna tidak dikenali: "${css}"`);
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if (alpha < 1) {
    throw new Error(
      `Warna semi-transparan tidak didukung helper ini: "${css}" (butuh compositing eksplisit)`
    );
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
}

/** Relative luminance WCAG 2.x (0 = hitam, 1 = putih). */
export function relativeLuminance(color: Rgb): number {
  const channel = (value: number) => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(color[0]) +
    0.7152 * channel(color[1]) +
    0.0722 * channel(color[2])
  );
}

/** Rasio kontras WCAG antara dua warna opak (1..21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Warna permukaan kontrol (`backgroundColor` hasil render). */
export async function readSurfaceColor(locator: Locator): Promise<Rgb> {
  return parseRgb(
    await locator.evaluate((node) => getComputedStyle(node).backgroundColor)
  );
}

/**
 * Warna teks kontrol. `"placeholder"` membaca warna pseudo-element
 * `::placeholder` (didukung Chromium); tanpa argumen membaca warna teks biasa.
 *
 * Elemen tanpa atribut `placeholder` ditolak: Chromium mengembalikan warna teks
 * biasa untuk `::placeholder` yang tidak ada, yang akan menghasilkan rasio
 * "placeholder" palsu sebesar rasio nilai — kegagalan yang senyap dan
 * menyesatkan.
 */
export async function readTextColor(
  locator: Locator,
  pseudo?: "placeholder"
): Promise<Rgb> {
  return parseRgb(
    await locator.evaluate((node, target) => {
      if (target !== "placeholder") return getComputedStyle(node).color;
      const declared =
        node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
          ? node.placeholder
          : null;
      if (!declared) {
        throw new Error(
          "readTextColor(element, 'placeholder') butuh elemen dengan atribut placeholder yang terisi"
        );
      }
      return getComputedStyle(node, "::placeholder").color;
    }, pseudo)
  );
}
