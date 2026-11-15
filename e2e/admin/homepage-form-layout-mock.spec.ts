/**
 * Homepage section form layout contract (create + edit).
 *
 * Regression: /admin/homepage/new and /admin/homepage/[id]/edit rendered every
 * field straight onto the page canvas (`bg-background`, #F2F3F3). The editable
 * field fill (`bg-field`, #F9FAFB) is only ~7/255 away from that canvas, so the
 * admin could not see where the form started or where a field ended — the same
 * class of bug `branch-form-layout-mock.spec.ts` pinned for the branch editor.
 * Every other admin editor groups fields into `Card` sections (Cabang,
 * Pengguna) whose white surface is what makes the field fill readable.
 *
 * This spec pins the user-visible contract, not the JSX:
 *   1. both pages group the form into labeled cards ("Informasi Section",
 *      "Konten Section", "Status Section") and each card's surface colour
 *      DIFFERS from the field fill inside it;
 *   2. a repeatable item (banner slide) sits on its own surface that differs
 *      from the card it lives in — a slide box must not disappear into the card;
 *   3. announcement_bar sections hide the "Informasi Section" card (no title /
 *      subtitle) but keep the other two.
 *
 * Run: npx playwright test --config=playwright.mock.config.ts e2e/admin/homepage-form-layout-mock.spec.ts
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { Pool } from "pg";
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

// ---------------------------------------------------------------------------
// Run-environment contract (also set by playwright.mock.config.ts; keep in sync)
// ---------------------------------------------------------------------------

const ADMIN_BASE_URL =
  process.env.E2E_MOCK_ADMIN_BASE_URL ?? "http://localhost:3111";
const MOCK_BASE_URL =
  process.env.E2E_MOCK_API_BASE_URL ?? "http://127.0.0.1:3112";
const MOCK_PORTS = new Set(["3110", "3111", "3112"]);

/** Fail closed unless the ISOLATED mock run (loopback flags pinned). */
function requireIsolatedMockRun(): void {
  if (
    process.env.E2E_PROVIDER_MOCKS !== "true" ||
    !process.env.E2E_MOCK_ADMIN_BASE_URL ||
    !process.env.E2E_MOCK_API_BASE_URL
  ) {
    throw new Error(
      "homepage-form-layout-mock.spec.ts must run under playwright.mock.config.ts: E2E_PROVIDER_MOCKS=true with E2E_MOCK_ADMIN_BASE_URL/E2E_MOCK_API_BASE_URL set"
    );
  }
  for (const [name, raw] of [
    ["admin", ADMIN_BASE_URL],
    ["mock", MOCK_BASE_URL],
  ] as const) {
    const parsed = new URL(raw);
    const loopback =
      parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    if (!loopback || !MOCK_PORTS.has(parsed.port)) {
      throw new Error(
        `homepage-form-layout-mock.spec.ts refuses a non-loopback/foreign-port ${name} base (${raw}); the isolated mock ports are 3110/3111/3112`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Fixtures: one run-unique banner section + the seeded HQ actor
// ---------------------------------------------------------------------------

const HQ = {
  identifier: process.env.E2E_ADMIN_HQ_IDENTIFIER || "hqmanager",
  password: process.env.E2E_ADMIN_HQ_PASSWORD || "hq123",
};

const FIXTURE_TITLE = "E2E Form Layout Banner";
const FIXTURE_SUBTITLE = "Section untuk kontrak layout form";

/** The section cards an editor must see, mapped to their final copy. */
const CARDS = {
  information: {
    name: "Informasi Section",
    description: "Judul dan subtitle yang tampil di atas section.",
  },
  content: { name: "Konten Section" },
  status: {
    name: "Status Section",
    description: "Section nonaktif tidak tampil di storefront.",
  },
} as const;

let pool: Pool;
let hqContext: BrowserContext;
let sectionId = "";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Signs in a Better Auth session over public HTTP on the isolated origin. */
async function httpSignIn(
  context: BrowserContext,
  base: string,
  identifier: string,
  password: string
): Promise<void> {
  const response = await context.request.post(
    `${base}/api/auth/sign-in/username`,
    { data: { username: identifier, password } }
  );
  expect(
    response.ok(),
    `HTTP sign-in seam failed for ${identifier}: ${await response.text()}`
  ).toBe(true);
}

function bannerBody() {
  return {
    type: "banner",
    title: FIXTURE_TITLE,
    subtitle: FIXTURE_SUBTITLE,
    content: {
      slides: [
        { imageUrl: "/uploads/e2e-layout-slide.png", altText: "Slide layout" },
      ],
      ctaText: "Belanja Sekarang",
      ctaLink: "/products",
      autoRotateIntervalSec: 5,
    },
    isActive: true,
  };
}

/** The card that owns `heading`, located by its rendered surface. */
function sectionCard(page: Page, heading: string) {
  return page
    .getByRole("heading", { name: heading, exact: true })
    .locator(
      'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " bg-card ")][1]'
    );
}

/** Asserts the labeled card + field/surface contrast contract for `heading`. */
async function expectReadableCard(page: Page, heading: string) {
  const card = sectionCard(page, heading);
  await expect(card, `${heading} must render as a Card surface`).toHaveCount(1);

  // The field fill must differ from the surface behind it — the reported bug
  // was `field colour === page colour`, so the two sampled colours are the
  // assertion, not a class name.
  const colours = await card.evaluate((element) => {
    const field = element.querySelector<HTMLElement>(
      "input:not([type=hidden]):not([type=checkbox]):not([type=file]), textarea"
    );
    if (!field) return null;
    return {
      surface: getComputedStyle(element).backgroundColor,
      fill: getComputedStyle(field).backgroundColor,
    };
  });
  expect(colours, `${heading} must contain at least one field`).not.toBeNull();
  expect(
    colours!.surface,
    `${heading}: the card surface must be opaque`
  ).not.toMatch(/rgba\(.*,\s*0(\.\d+)?\)$/);
  expect(
    colours!.fill,
    `${heading}: the field fill must differ from the surface behind it`
  ).not.toBe(colours!.surface);
}

/**
 * Asserts the field located by `label` sits on its own region whose colour
 * differs from the card surface — a repeatable item box must stay visible
 * inside the card instead of melting into it.
 */
async function expectFieldOnOwnRegion(page: Page, cardHeading: string, label: string) {
  const field = page.getByLabel(label, { exact: true }).first();
  await expect(field, `${label} must be associable to its field`).toBeVisible();

  const cardBg = await sectionCard(page, cardHeading).evaluate(
    (element) => getComputedStyle(element).backgroundColor
  );

  const regionBg = await field.evaluate((element) => {
    let node = element.parentElement;
    while (node) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
      node = node.parentElement;
    }
    return "rgba(0, 0, 0, 0)";
  });

  expect(
    regionBg,
    `${label}: the item box must paint its own surface`
  ).not.toBe("rgba(0, 0, 0, 0)");
  expect(
    regionBg,
    `${label}: the item box surface must differ from the card surface behind it`
  ).not.toBe(cardBg);
}

// ---------------------------------------------------------------------------
// Fixture lifecycle
// ---------------------------------------------------------------------------

test.beforeAll(async ({ browser }) => {
  requireIsolatedMockRun();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Heal leftovers from an interrupted previous run (deterministic title).
  await pool.query(`DELETE FROM homepage_section WHERE title = $1`, [
    FIXTURE_TITLE,
  ]);

  hqContext = await browser.newContext({ baseURL: ADMIN_BASE_URL });
  await httpSignIn(hqContext, ADMIN_BASE_URL, HQ.identifier, HQ.password);

  const create = await hqContext.request.post("/api/admin/homepage", {
    data: bannerBody(),
  });
  expect(
    create.ok(),
    `fixture section create failed (${create.status()}): ${await create.text()}`
  ).toBe(true);
  const created = (await create.json()) as { data?: { id?: string } };
  sectionId = String(created.data?.id ?? "");
  expect(sectionId.length, "fixture section id must be returned").toBeGreaterThan(0);
});

test.afterAll(async () => {
  if (hqContext && sectionId && pool) {
    const res = await hqContext.request
      .delete(`/api/admin/homepage/${sectionId}`)
      .catch(() => null);
    if (!res || !res.ok()) {
      await pool
        .query(`DELETE FROM homepage_section WHERE title = $1`, [FIXTURE_TITLE])
        .catch(() => {});
    }
  }
  await hqContext?.close().catch(() => {});
  if (pool) await pool.end();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("homepage section form layout", () => {
  test.describe.configure({ mode: "serial" });

  test("edit page groups the form into readable cards", async () => {
    const page = await hqContext.newPage();
    try {
      await page.goto(`/admin/homepage/${sectionId}/edit`);
      await expect(page.getByLabel("Judul", { exact: true })).toHaveValue(
        FIXTURE_TITLE
      );

      for (const card of [CARDS.information, CARDS.content, CARDS.status]) {
        await expect(
          page.getByRole("heading", { name: card.name, exact: true })
        ).toBeVisible();
      }
      await expect(page.getByText(CARDS.information.description)).toBeVisible();
      await expect(page.getByText(CARDS.status.description)).toBeVisible();

      await expectReadableCard(page, CARDS.information.name);
      await expectReadableCard(page, CARDS.content.name);

      // A banner slide is a repeatable item: it must paint its own surface on
      // top of the card instead of being separated by a faint 1px border only.
      await expectFieldOnOwnRegion(
        page,
        CARDS.content.name,
        "Alt Text (aksesibilitas)"
      );

      // Filter mode exposes a derived (read-only) URL field: it renders on the
      // locked tone, so it must stay visible against the surface behind it.
      await page.getByRole("button", { name: "Filter Produk" }).click();
      const built = page.locator("#cta-built-url");
      await expect(built).toBeVisible();
      const lockedField = await built.evaluate((element) => {
        let node = element.parentElement;
        while (node) {
          const bg = getComputedStyle(node).backgroundColor;
          if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
            return {
              own: getComputedStyle(element).backgroundColor,
              surface: bg,
            };
          }
          node = node.parentElement;
        }
        return null;
      });
      expect(lockedField, "the derived URL field must sit on a surface").not.toBeNull();
      expect(
        lockedField!.own,
        "the derived URL field must differ from the surface behind it"
      ).not.toBe(lockedField!.surface);

      // The primary action is still reachable and unchanged.
      await expect(
        page.getByRole("button", { name: "Simpan Perubahan" })
      ).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("create page shares the same card structure", async () => {
    const page = await hqContext.newPage();
    try {
      await page.goto("/admin/homepage/new?type=banner");
      await expect(
        page.getByRole("heading", { name: CARDS.information.name, exact: true })
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: CARDS.content.name, exact: true })
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: CARDS.status.name, exact: true })
      ).toBeVisible();

      await expectReadableCard(page, CARDS.information.name);
      await expectReadableCard(page, CARDS.content.name);
      await expect(
        page.getByRole("button", { name: "Buat Section" })
      ).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("announcement bar hides the title card but keeps the content card", async () => {
    const page = await hqContext.newPage();
    try {
      await page.goto("/admin/homepage/new?type=announcement_bar");
      await expect(
        page.getByRole("heading", { name: CARDS.content.name, exact: true })
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: CARDS.status.name, exact: true })
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: CARDS.information.name, exact: true })
      ).toHaveCount(0);

      await expectReadableCard(page, CARDS.content.name);
    } finally {
      await page.close();
    }
  });

  test("the restructured create form still creates a section", async () => {
    const createdTitle = `${FIXTURE_TITLE} (baru)`;
    const page = await hqContext.newPage();
    let createdId = "";
    try {
      await page.goto("/admin/homepage/new?type=banner");
      await page.getByLabel("Judul", { exact: true }).fill(createdTitle);
      await page.getByLabel("Subtitle", { exact: true }).fill("Dibuat oleh E2E");
      await page.getByRole("button", { name: "Buat Section" }).click();
      await page.waitForURL("**/admin/homepage");

      // The row carries the badge + title the admin typed in the card.
      const row = page
        .locator("div.rounded-lg.border.bg-card", { hasText: createdTitle })
        .last();
      await expect(row).toBeVisible();

      const list = (await (
        await hqContext.request.get("/api/admin/homepage")
      ).json()) as { data?: { id: string; title: string | null }[] };
      createdId =
        list.data?.find((section) => section.title === createdTitle)?.id ?? "";
      expect(createdId, "the created section must be persisted").not.toBe("");
    } finally {
      if (createdId) {
        await hqContext.request
          .delete(`/api/admin/homepage/${createdId}`)
          .catch(() => null);
      }
      await page.close();
    }
  });
});
