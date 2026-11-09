/**
 * Spec penyelarasan status/notifikasi/email — kolom **Jenis Order** dan aksi
 * per cara pemenuhan pada halaman notifikasi admin.
 *
 * Mock-only (isolated origins 3110/3111/3112, disposable DB) dan serial:
 * (1) list: header Jenis Order, badge Pickup/Delivery, aksi Delivery
 *     "Buka order" ke detail biasa (tanpa `?verify=1`) dan aksi pickup
 *     "Verifikasi pickup" existing, plus baca/hapus yang tidak rusak;
 * (2) own-branch scope: notifikasi cabang lain tidak terlihat;
 * (3) data jenis tidak tersedia dirender `—` (bukan ditebak pickup) dan
 *     baris baru dari live update langsung membawa Jenis Order.
 *
 * Bukti yang dipakai adalah UI yang dirender browser, bukan inspeksi JSX.
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

const ADMIN_BASE_URL =
  process.env.E2E_MOCK_ADMIN_BASE_URL ?? "http://localhost:3111";

const PREFIX = "e2enotif";
const PASSWORD = "E2ENotif2026";
const BRANCH_A = `${PREFIX}-branch-a`;
const BRANCH_B = `${PREFIX}-branch-b`;
const ROLE_ID = `${PREFIX}-role`;
const USER_ID = `${PREFIX}-user`;
const CLIENT_ID = `${PREFIX}-client`;
const PICKUP_ORDER = `${PREFIX}-order-pickup`;
const DELIVERY_ORDER = `${PREFIX}-order-delivery`;
const FOREIGN_ORDER = `${PREFIX}-order-foreign`;

let pool: Pool;
let context: BrowserContext;

async function signIn(
  browser: import("@playwright/test").Browser
): Promise<BrowserContext> {
  const created = await browser.newContext({ baseURL: ADMIN_BASE_URL });
  const response = await created.request.post(
    `${ADMIN_BASE_URL}/api/auth/sign-in/username`,
    { data: { username: "notifadmin", password: PASSWORD } }
  );
  expect(response.ok(), await response.text()).toBe(true);
  return created;
}

test.beforeAll(async ({ browser }) => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(
    `DELETE FROM notification WHERE order_id LIKE '${PREFIX}-%'`
  );
  await pool.query(
    `DELETE FROM order_email_job WHERE order_id LIKE '${PREFIX}-%'`
  );
  await pool.query(
    `DELETE FROM order_communication_event WHERE order_id LIKE '${PREFIX}-%'`
  );
  await pool.query(
    `DELETE FROM jubelio_channel_status_intent WHERE order_id LIKE '${PREFIX}-%'`
  );
  await pool.query(
    `DELETE FROM jubelio_sales_operation WHERE order_id LIKE '${PREFIX}-%'`
  );
  await pool.query(`DELETE FROM orders WHERE id LIKE '${PREFIX}-%'`);
  await pool.query("DELETE FROM admin_session WHERE user_id LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM admin_account WHERE user_id LIKE $1", [`${PREFIX}-%`]);
  await pool.query('DELETE FROM "user" WHERE id LIKE $1', [`${PREFIX}-%`]);
  await pool.query("DELETE FROM admin_role_grant WHERE role_id LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM admin_role WHERE id LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM branch WHERE id LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM client WHERE id LIKE $1", [`${PREFIX}-%`]);

  await pool.query(
    `INSERT INTO client (id,name,email,email_verified,phone,onboarding_completed)
     VALUES ($1,'Notif Mock Client','notif-mock@example.test',true,'+6281200000000',true)`,
    [CLIENT_ID]
  );
  await pool.query(
    `INSERT INTO branch (id,name,code,city,address,status,shipping_phone,shipping_address,shipping_postal_code,shipping_area_id,jubelio_location_id)
     VALUES ($1,'Cabang Notif A','E2ENOTA','Bandung','Jl. A 1','aktif','0211','Jl. A 1','40111','01010101',910001),
            ($2,'Cabang Notif B','E2ENOTB','Surabaya','Jl. B 1','aktif','0311','Jl. B 1','60111','02020101',910002)`,
    [BRANCH_A, BRANCH_B]
  );
  await pool.query(
    `INSERT INTO admin_role (id,name) VALUES ($1,'E2E Notif Operator')`,
    [ROLE_ID]
  );
  await pool.query(
    `INSERT INTO admin_role_grant (id,role_id,module,action,scope)
     VALUES ($1,$2,'notifications','view','own_branch'),
            ($3,$2,'notifications','edit','own_branch'),
            ($4,$2,'notifications','delete','own_branch'),
            ($5,$2,'orders','view','own_branch')`,
    [
      `${PREFIX}-g1`,
      ROLE_ID,
      `${PREFIX}-g2`,
      `${PREFIX}-g3`,
      `${PREFIX}-g4`,
    ]
  );
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  await pool.query(
    `INSERT INTO "user" (id,name,username,display_username,email,email_verified,role_id,branch_id,is_active)
     VALUES ($1,'Notif Admin','notifadmin','notifadmin','notifadmin@example.test',true,$2,$3,true)`,
    [USER_ID, ROLE_ID, BRANCH_A]
  );
  await pool.query(
    `INSERT INTO admin_account (id,user_id,account_id,provider_id,password)
     VALUES ($1,$2,$2,'credential',$3)`,
    [`${USER_ID}-account`, USER_ID, passwordHash]
  );

  for (const [orderId, method, branchId] of [
    [PICKUP_ORDER, "pickup", BRANCH_A],
    [DELIVERY_ORDER, "delivery", BRANCH_A],
    [FOREIGN_ORDER, "delivery", BRANCH_B],
  ] as const) {
    await pool.query(
      `INSERT INTO orders (id,user_id,branch_id,status,payment_status,fulfillment_method,pickup_code,contact_phone,contact_email,subtotal,total,order_communication_version)
       VALUES ($1,$2,$3,'ready_for_pickup','paid',$4,$5,'0800000000','notif-mock@example.test','100000','111000',1)`,
      [
        orderId,
        CLIENT_ID,
        branchId,
        method,
        method === "pickup" ? "PKP999" : null,
      ]
    );
    await pool.query(
      `INSERT INTO notification (id,type,order_id,branch_id,title,message,is_read)
       VALUES ($1,'order_paid',$2,$3,$4,$5,false)`,
      [
        `${orderId}-notif`,
        orderId,
        branchId,
        method === "pickup"
          ? "Order Paid — Ready for Pickup"
          : "Order dibayar — siap diproses",
        method === "pickup"
          ? "Order #E2ENOTI has been paid and is ready for pickup."
          : branchId === BRANCH_B
            ? "Order #CABANGLN cabang lain sudah dibayar."
            : "Order #E2ENOTI sudah dibayar dan siap disiapkan untuk pengiriman.",
      ]
    );
  }

  context = await signIn(browser);
});

test.afterAll(async () => {
  await context?.close().catch(() => {});
  if (!pool) return;
  await pool.query(`DELETE FROM notification WHERE order_id LIKE '${PREFIX}-%'`);
  await pool.query(
    `DELETE FROM order_email_job WHERE order_id LIKE '${PREFIX}-%'`
  );
  await pool.query(
    `DELETE FROM order_communication_event WHERE order_id LIKE '${PREFIX}-%'`
  );
  await pool.query(
    `DELETE FROM jubelio_channel_status_intent WHERE order_id LIKE '${PREFIX}-%'`
  );
  await pool.query(
    `DELETE FROM jubelio_sales_operation WHERE order_id LIKE '${PREFIX}-%'`
  );
  await pool.query(`DELETE FROM orders WHERE id LIKE '${PREFIX}-%'`);
  await pool.query("DELETE FROM admin_session WHERE user_id LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM admin_account WHERE user_id LIKE $1", [`${PREFIX}-%`]);
  await pool.query('DELETE FROM "user" WHERE id LIKE $1', [`${PREFIX}-%`]);
  await pool.query("DELETE FROM admin_role_grant WHERE role_id LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM admin_role WHERE id LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM branch WHERE id LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM client WHERE id LIKE $1", [`${PREFIX}-%`]);
  await pool.end();
});

test.describe("notifikasi admin — kolom dan aksi Jenis Order", () => {
  test.describe.configure({ mode: "serial" });

  test("menampilkan badge jenis dan aksi yang benar per cara pemenuhan, scoped ke cabang sendiri", async () => {
    const page = await context.newPage();
    await page.goto("/admin/notifications");

    await expect(
      page.getByRole("columnheader", { name: "Jenis Order" })
    ).toBeVisible();

    const pickupRow = page
      .getByRole("row")
      .filter({ hasText: "Order Paid — Ready for Pickup" });
    await expect(pickupRow.getByText("Pickup", { exact: true })).toBeVisible();
    const verifyLink = pickupRow.getByRole("link", { name: "Verifikasi pickup" });
    await expect(verifyLink).toHaveAttribute(
      "href",
      `/admin/orders/${PICKUP_ORDER}?verify=1`
    );

    const deliveryRow = page
      .getByRole("row")
      .filter({ hasText: "Order dibayar — siap diproses" });
    await expect(
      deliveryRow.getByText("Delivery", { exact: true })
    ).toBeVisible();
    const openLink = deliveryRow.getByRole("link", { name: "Buka order" });
    await expect(openLink).toHaveAttribute(
      "href",
      `/admin/orders/${DELIVERY_ORDER}`
    );

    // Own-branch scope: notifikasi cabang lain tidak pernah terlihat.
    await expect(
      page.getByRole("row").filter({ hasText: "CABANGLN" })
    ).toHaveCount(0);

    // Perilaku existing (hapus) tetap bekerja.
    await pickupRow.getByRole("button", { name: "Hapus" }).click();
    await expect(pickupRow).toHaveCount(0);

    // Semantik tabel dipertahankan pada viewport sempit + bukti render untuk
    // review UX manual (desktop/tablet/mobile) di playwright/mcp/.
    for (const [label, width, height] of [
      ["desktop", 1440, 900],
      ["tablet", 768, 1024],
      ["mobile", 390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expect(
        page.getByRole("columnheader", { name: "Jenis Order" })
      ).toBeVisible();
      await expect(
        page.getByRole("row").filter({ hasText: "Order dibayar — siap diproses" })
      ).toBeVisible();
      // Tabel boleh scroll horizontal DI DALAM regionnya; halaman tidak boleh
      // overflow horizontal.
      const metrics = await page.evaluate(() => {
        const region = document.querySelector("table")?.parentElement ?? null;
        return {
          pageOverflow:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
          regionScrollable: region
            ? region.scrollWidth > region.clientWidth
            : false,
        };
      });
      expect(metrics.pageOverflow).toBeLessThanOrEqual(1);
      if (label === "mobile") {
        expect(metrics.regionScrollable).toBe(true);
      }
      await page.screenshot({
        path: `playwright/mcp/order-notifications/${label}.png`,
        fullPage: false,
      });
    }
    // Halaman peer (daftar pesanan) pada viewport yang sama untuk perbandingan
    // konsistensi tabel/badge/spacing.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/admin/orders");
    await page.screenshot({
      path: "playwright/mcp/order-notifications/peer-orders-desktop.png",
      fullPage: false,
    });
    await page.close();
  });

  test("data jenis tidak tersedia dirender — dan baris live update membawa jenisnya", async () => {
    const page = await context.newPage();
    // Respons list dipaksa memuat satu item tanpa jenis order.
    const listRoute = /\/api\/admin\/notifications\?/;
    await page.route(listRoute, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const template = body.data[0] ?? {};
      body.data = [
        {
          ...template,
          id: "e2enotif-unknown-notif",
          title: "Order dibayar — jenis tidak diketahui",
          message: "Order #TIDAKDIT jenis order tidak tercatat.",
          order: { ...(template.order ?? {}), fulfillmentMethod: null },
        },
        { ...template, title: "Order dibayar — siap diproses" },
      ];
      await route.fulfill({ response, json: body });
    });
    await page.goto("/admin/notifications");
    const unknownRow = page
      .getByRole("row")
      .filter({ hasText: "jenis tidak diketahui" });
    // Kolom ketiga (Judul, Order, Jenis Order) untuk own-branch viewer.
    await expect(unknownRow.getByRole("cell").nth(2)).toHaveText("—");
    await page.unroute(listRoute);

    // Live update nyata: baris baru (lewat pg_notify) langsung membawa jenis.
    const liveNotifId = `${PREFIX}-live-notif`;
    await pool.query(
      `INSERT INTO notification (id,type,order_id,branch_id,title,message,is_read)
       VALUES ($1,'order_paid',$2,$3,'Order dibayar — siap diproses','Order #E2ENOTI sudah dibayar dan siap disiapkan untuk pengiriman.',false)`,
      [liveNotifId, DELIVERY_ORDER, BRANCH_A]
    );
    await pool.query(`SELECT pg_notify('new_notification', $1)`, [
      JSON.stringify({ id: liveNotifId }),
    ]);
    const liveRow = page
      .getByRole("row")
      .filter({ hasText: "Order dibayar — siap diproses" })
      .first();
    await expect(liveRow.getByText("Delivery", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await pool.query(`DELETE FROM notification WHERE id = $1`, [liveNotifId]);
    await page.close();
  });
});
