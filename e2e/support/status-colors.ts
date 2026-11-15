/**
 * Helper kontrak warna status untuk spec E2E.
 *
 * Sumber expected adalah **literal** palet spec
 * (`.scratch/ux-design/plan/semantic-status-colors-spec.md` §7.1), bukan token
 * implementasi atau daftar kelas Tailwind. Assertion membaca hasil render
 * nyata (`getComputedStyle`) sehingga yang diuji adalah warna yang dilihat
 * pengguna, bukan string class.
 *
 * Kontrak yang dikunci:
 * 1. setiap indikator status menandai tone-nya (`data-status-tone`) dan
 *    tone tersebut cocok dengan makna labelnya;
 * 2. warna background/teks/border opaque sama persis dengan palet light atau
 *    dark yang disepakati — implisit membuktikan kesamaan lintas app karena
 *    kedua spec memakai palet literal yang sama;
 * 3. kontras teks terhadap background ≥ 4.5:1 (SC 1.4.3 untuk `text-xs`);
 * 4. hover pasif tidak mengubah warna indikator status.
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { contrastRatio, parseRgb, type Rgb } from "./contrast";

export type StatusTone =
  | "waiting"
  | "progress"
  | "ready"
  | "info"
  | "success"
  | "error"
  | "cancelled"
  | "neutral";

export type StatusTheme = "light" | "dark";

interface ToneColors {
  background: string;
  foreground: string;
  border: string;
}

export const STATUS_PALETTE: Record<
  StatusTone,
  Record<StatusTheme, ToneColors>
> = {
  waiting: {
    light: { background: "#FFF7ED", foreground: "#9A3412", border: "#FED7AA" },
    dark: { background: "#431407", foreground: "#FED7AA", border: "#9A3412" },
  },
  progress: {
    light: { background: "#FEF3C7", foreground: "#92400E", border: "#FDE68A" },
    dark: { background: "#451A03", foreground: "#FDE68A", border: "#92400E" },
  },
  ready: {
    light: { background: "#F0FDFA", foreground: "#115E59", border: "#99F6E4" },
    dark: { background: "#042F2E", foreground: "#99F6E4", border: "#115E59" },
  },
  info: {
    light: { background: "#EFF6FF", foreground: "#1E40AF", border: "#BFDBFE" },
    dark: { background: "#172554", foreground: "#BFDBFE", border: "#1E40AF" },
  },
  success: {
    light: { background: "#ECFDF5", foreground: "#065F46", border: "#A7F3D0" },
    dark: { background: "#022C22", foreground: "#A7F3D0", border: "#065F46" },
  },
  error: {
    light: { background: "#FEF2F2", foreground: "#991B1B", border: "#FECACA" },
    dark: { background: "#450A0A", foreground: "#FECACA", border: "#991B1B" },
  },
  cancelled: {
    light: { background: "#FFF1F2", foreground: "#9F1239", border: "#FECDD3" },
    dark: { background: "#4C0519", foreground: "#FECDD3", border: "#9F1239" },
  },
  neutral: {
    light: { background: "#F1F5F9", foreground: "#334155", border: "#CBD5E1" },
    dark: { background: "#0F172A", foreground: "#CBD5E1", border: "#475569" },
  },
};

/** Teks badge kecil tidak masuk pengecualian "large text" WCAG. */
export const STATUS_TEXT_MIN_CONTRAST = 4.5;

function hexToRgb(hex: string): Rgb {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ] as const;
}

export function expectedToneColors(
  tone: StatusTone,
  theme: StatusTheme
): Record<keyof ToneColors, Rgb> {
  const pair = STATUS_PALETTE[tone][theme];
  return {
    background: hexToRgb(pair.background),
    foreground: hexToRgb(pair.foreground),
    border: hexToRgb(pair.border),
  };
}

/**
 * Theme hanya dapat dipasang lewat class `dark` pada `<html>` (tailwind
 * `darkMode: "class"`); tidak ada theme switcher di aplikasi dan spec ini tidak
 * menambahkannya ke produk.
 */
export async function setStatusTheme(page: Page, theme: StatusTheme) {
  await page.evaluate((next) => {
    document.documentElement.classList.toggle("dark", next === "dark");
  }, theme);
}

export interface RenderedColors {
  background: Rgb;
  foreground: Rgb;
  border: Rgb;
}

export async function readToneColors(locator: Locator): Promise<RenderedColors> {
  const raw = await locator.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      background: style.backgroundColor,
      foreground: style.color,
      borderColor: style.borderTopColor,
    };
  });
  return {
    background: parseRgb(raw.background),
    foreground: parseRgb(raw.foreground),
    border: parseRgb(raw.borderColor),
  };
}

/**
 * Satu indikator status: tone yang ditandai, warna palet theme yang dipakai,
 * dan kontras teks minimal 4.5:1.
 */
export async function expectStatusTone(
  locator: Locator,
  tone: StatusTone,
  theme: StatusTheme = "light"
) {
  await expect(locator).toBeVisible();
  await expect(locator).toHaveAttribute("data-status-tone", tone);
  const expected = expectedToneColors(tone, theme);
  // Badge memakai `transition-colors`: saat theme berganti, warna sempat
  // teranimasi. Poll sampai warna final yang dilihat pengguna stabil.
  await expect
    .poll(async () => readToneColors(locator), {
      message: `warna status ${tone}/${theme}`,
      timeout: 5_000,
    })
    .toEqual(expected);
  const rendered = await readToneColors(locator);
  expect(
    contrastRatio(rendered.foreground, rendered.background),
    `kontras teks ${tone}/${theme}`
  ).toBeGreaterThanOrEqual(STATUS_TEXT_MIN_CONTRAST);
}

/** Status pill pasif: tone tidak boleh berubah saat hover. */
export async function expectStableOnHover(locator: Locator) {
  await locator.hover();
  const before = await readToneColors(locator);
  await locator.hover();
  const after = await readToneColors(locator);
  expect(after).toEqual(before);
}
