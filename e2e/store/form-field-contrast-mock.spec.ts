/**
 * Form-field tone contract — an EMPTY field must not read as a FILLED one.
 *
 * Regression: every shared `Input`/`Textarea`/`SelectTrigger`
 * (packages/ui, consumed by BOTH apps) painted its placeholder with
 * `--muted-foreground` (#1D566D). Against the `--field` surface (#F9FAFB) that
 * is 7.7:1 — almost the value text's 16.9:1 — so on /checkout the
 * "Nama Penerima" and "Alamat Lengkap" prompts looked like typed content and
 * the operator could not tell which fields still needed filling.
 *
 * The contract pinned here is the user-visible outcome on the shared control,
 * measured from the rendered pixels (never from the class strings):
 *   1. the placeholder sits in the faint band (2,6–4:1 against the field
 *      surface, currently ≈3,6:1);
 *   2. the real value stays strong (≥ 12:1);
 *   3. typing switches the visible tone from the faint prompt to the strong
 *      value colour, so the two states differ by more than a shade.
 *
 * Expected values are computed with the WCAG contrast formula from
 * ../support/contrast; only the thresholds are declared here.
 *
 * Public login pages are used on purpose: this is a token/component contract,
 * so it needs no session, no seeded rows and no provider mock.
 *
 * Run: npx playwright test --config=playwright.mock.config.ts
 */
import { test, expect, type Page } from "@playwright/test";
import {
  FAINT_PLACEHOLDER_MAX,
  FAINT_PLACEHOLDER_MIN,
  VALUE_MIN_CONTRAST,
  contrastRatio,
  readSurfaceColor,
  readTextColor,
} from "../support/contrast";

// ---------------------------------------------------------------------------
// Run-environment contract (also set by playwright.mock.config.ts; keep in sync)
// ---------------------------------------------------------------------------

const STORE_BASE_URL =
  process.env.E2E_MOCK_STORE_BASE_URL ?? "http://localhost:3110";
const ADMIN_BASE_URL =
  process.env.E2E_MOCK_ADMIN_BASE_URL ?? "http://localhost:3111";
const MOCK_PORTS = new Set(["3110", "3111", "3112"]);

/** Fail closed unless the ISOLATED mock run (loopback flags pinned). */
function requireIsolatedMockRun(): void {
  if (
    process.env.E2E_PROVIDER_MOCKS !== "true" ||
    !process.env.E2E_MOCK_STORE_BASE_URL ||
    !process.env.E2E_MOCK_ADMIN_BASE_URL
  ) {
    throw new Error(
      "form-field-contrast-mock.spec.ts must run under playwright.mock.config.ts: E2E_PROVIDER_MOCKS=true with E2E_MOCK_STORE_BASE_URL/E2E_MOCK_ADMIN_BASE_URL set"
    );
  }
  for (const [name, raw] of [
    ["store", STORE_BASE_URL],
    ["admin", ADMIN_BASE_URL],
  ] as const) {
    const parsed = new URL(raw);
    const loopback =
      parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    if (!loopback || !MOCK_PORTS.has(parsed.port)) {
      throw new Error(
        `form-field-contrast-mock.spec.ts refuses a non-loopback/foreign-port ${name} base (${raw}); the isolated mock ports are 3110/3111/3112`
      );
    }
  }
}

// Faint, but still perceivable: the placeholder must be clearly weaker than a
// value while staying above "invisible grey" for low-vision users. The band is
// shared with the address-dialog assertions (see ../support/contrast).
const PLACEHOLDER_MIN_CONTRAST = FAINT_PLACEHOLDER_MIN;
const PLACEHOLDER_MAX_CONTRAST = FAINT_PLACEHOLDER_MAX;
// A filled field must differ by more than a shade from the prompt.
const TONE_SEPARATION_MIN = 2.5;

/** Tone triangle of one rendered form field: prompt, value and surface. */
async function fieldTones(page: Page, label: string) {
  const field = page.getByLabel(label);
  await expect(field).toBeVisible();

  const surface = await readSurfaceColor(field);
  const placeholder = await readTextColor(field, "placeholder");
  const value = await readTextColor(field);

  return {
    field,
    placeholderContrast: contrastRatio(placeholder, surface),
    valueContrast: contrastRatio(value, surface),
    toneSeparation: contrastRatio(placeholder, value),
    placeholderColor: placeholder.join(","),
    valueColor: value.join(","),
  };
}

test.describe("form field placeholder tone", () => {
  test("store field: prompt is faint, value is strong", async ({ page }) => {
    requireIsolatedMockRun();
    await page.goto(`${STORE_BASE_URL}/login`);

    const tones = await fieldTones(page, "Email");

    expect(tones.placeholderContrast).toBeGreaterThanOrEqual(
      PLACEHOLDER_MIN_CONTRAST
    );
    expect(tones.placeholderContrast).toBeLessThanOrEqual(
      PLACEHOLDER_MAX_CONTRAST
    );
    expect(tones.valueContrast).toBeGreaterThanOrEqual(VALUE_MIN_CONTRAST);
    expect(tones.toneSeparation).toBeGreaterThanOrEqual(TONE_SEPARATION_MIN);
  });

  test("admin field: the same shared component keeps the same tones", async ({
    page,
  }) => {
    requireIsolatedMockRun();
    await page.goto(`${ADMIN_BASE_URL}/login`);

    const tones = await fieldTones(page, "Email atau Username");

    expect(tones.placeholderContrast).toBeGreaterThanOrEqual(
      PLACEHOLDER_MIN_CONTRAST
    );
    expect(tones.placeholderContrast).toBeLessThanOrEqual(
      PLACEHOLDER_MAX_CONTRAST
    );
    expect(tones.valueContrast).toBeGreaterThanOrEqual(VALUE_MIN_CONTRAST);
    expect(tones.toneSeparation).toBeGreaterThanOrEqual(TONE_SEPARATION_MIN);
  });

  test("typing replaces the faint prompt with the strong value tone", async ({
    page,
  }) => {
    requireIsolatedMockRun();
    await page.goto(`${STORE_BASE_URL}/login`);

    const before = await fieldTones(page, "Email");
    await before.field.fill("nama@email.com");

    // The placeholder pseudo-element colour is unchanged (it is simply hidden);
    // what changes is the rendered text tone.
    const afterValueContrast = contrastRatio(
      await readTextColor(before.field),
      await readSurfaceColor(before.field)
    );

    expect(afterValueContrast).toBeGreaterThanOrEqual(VALUE_MIN_CONTRAST);
    expect(afterValueContrast).toBeCloseTo(before.valueContrast, 5);

    // Sanity check the two tones are genuinely different colours, so a future
    // edit cannot "pass" by making the placeholder and the value identical.
    expect(before.placeholderColor).not.toEqual(before.valueColor);
  });
});
