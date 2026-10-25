/**
 * Helper interaksi `Select` (Radix) shared untuk spec E2E.
 *
 * `<select>` native bisa dipilih lewat `selectOption`; `Select` Radix tidak,
 * karena opsinya baru ada di DOM saat popover terbuka. Helper ini menjaga satu
 * pola interaksi untuk semua spec supaya migrasi kontrol tidak menduplikasi
 * urutan klik di banyak tempat.
 */
import { expect, type Page } from "@playwright/test";

/** Pilih `optionName` pada `Select` yang diasosiasikan dengan `label`. */
export async function pickSelectOption(
  page: Page,
  label: string,
  optionName: string
): Promise<void> {
  await page.getByLabel(label).click();
  const option = page.getByRole("option", { name: optionName, exact: true });
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
}
