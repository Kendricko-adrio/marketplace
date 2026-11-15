import { test, expect } from "@playwright/test";
const id = "guided-action-fixture";
const fixture = {
  id, status: "processing", paymentStatus: "paid", fulfillmentMethod: "delivery", createdAt: "2026-05-01T08:00:00Z",
  customer: { name: "Fixture Customer", email: "fixture@example.test" }, branch: { id: "fixture", name: "Bandung", city: "Bandung", address: "Origin" },
  contactPhone: "0800000000", stockOperations: [], items: [{ id: "item", productName: "Frozen goods", quantity: 2, price: "50000", imageUrl: null }],
  subtotal: "100000", shippingCost: "20000", discount: "0", serviceFee: "0", ppnRate: "11", ppnAmount: "13200", total: "133200",
  deliverySnapshot: { address: { recipientName: "Frozen Recipient", fullAddress: "Frozen Destination", city: "Bandung", province: "Jawa Barat", district: "Fixture District", area: "Fixture Area", postalCode: "12345", phone: "0800000000" }, service: { name: "Frozen Courier REG", shippingCost: "20000" } },
  workflow: { stage: { label: "Barang siap", guidance: "Barang siap. Pesan pengiriman.", terminal: false }, access: { known: true, allowed: true, reasons: [] }, eligibility: { known: true, eligible: true }, special: { failure: true, release: false, finish: false } },
  shipment: { state: "packed", attemptCount: 0 },
};
test("manual closure requires a reason and discloses all consequences, then remains distinct from arrival", async ({ page }) => {
  let closed = false;
  await page.route(`**/api/admin/orders/${id}`, (route) => route.fulfill({ json: { success: true, data: { ...fixture, status: closed ? "completed" : "processing", deliveryManualAt: closed ? "2026-05-01T12:00:00Z" : null, deliveryManualReason: closed ? "External resolution recorded" : null,
    shipment: { state: "booked", awb: "RETURNED-AWB", latestStatus: "RETURNED", bookedPrice: "25000" },
    workflow: { ...fixture.workflow, stage: closed ? { label: "Selesai manual", guidance: "Order ditutup manual.", terminal: true } : { label: "Barang dikembalikan", guidance: "Kurir melaporkan pengembalian. Tindak lanjuti kendala.", terminal: false }, special: { failure: false, release: false, finish: !closed } },
  } } }));
  await page.route(`**/api/admin/orders/${id}/delivery/finish-manually`, (route) => { expect(route.request().postDataJSON()).toEqual({ reason: "External resolution recorded" }); closed = true; return route.fulfill({ json: { success: true } }); });
  await page.goto(`/admin/orders/${id}`);
  await page.getByText("Penanganan khusus", { exact: true }).click();
  await page.getByRole("button", { name: "Selesaikan manual", exact: true }).click();
  await expect(page.getByRole("button", { name: "Konfirmasi selesai manual" })).toBeDisabled();
  await expect(page.getByText("Tidak mengonfirmasi barang diterima pelanggan dan tidak membuat status DELIVERED atau bukti penerimaan.")).toBeVisible();
  await expect(page.getByText("Tidak melakukan refund.")).toBeVisible();
  await expect(page.getByText("Tidak menyesuaikan stok.")).toBeVisible();
  await expect(page.getByText("Tidak membatalkan Sales Order (SO).")).toBeVisible();
  await expect(page.getByText("Tidak mengirim komunikasi otomatis.")).toBeVisible();
  await page.getByLabel("Alasan penutupan").fill("External resolution recorded");
  await page.getByRole("button", { name: "Konfirmasi selesai manual" }).click();
  await expect(page.getByRole("region", { name: "Langkah berikutnya" })).toContainText("Order ditutup manual.");
  await expect(page.getByText("Penutupan manual bukan konfirmasi barang diterima pelanggan.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Selesaikan manual", exact: true })).toHaveCount(0);
});

test("proof release needs two explicit current-attempt acknowledgements and never automatically books", async ({ page }) => {
  let released = false; const writes: Array<{ action: string; body: { proof?: { attemptNumber: number; absenceConfirmed: boolean; operationClosed: boolean } } }> = [];
  await page.route(`**/api/admin/orders/${id}`, (route) => route.fulfill({ json: { success: true, data: released ? { ...fixture, shipment: { state: "packed", attemptCount: 1 }, workflow: { ...fixture.workflow, stage: { label: "Barang siap", guidance: "Booking sebelumnya tidak terbentuk. Pesan pengiriman.", terminal: false } } } : { ...fixture, shipment: { state: "booking_unknown", attemptCount: 1 }, workflow: { ...fixture.workflow, stage: { label: "Booking belum pasti", guidance: "Konfirmasi ke Jubelio. Jangan pesan ulang.", terminal: false }, special: { failure: false, release: true, finish: false } } } } }));
  await page.route(`**/api/admin/orders/${id}/delivery/*`, (route) => { writes.push({ action: route.request().url().split("/").pop()!, body: route.request().postDataJSON() }); released = true; return route.fulfill({ json: { success: true } }); });
  await page.goto(`/admin/orders/${id}`);
  await page.getByText("Penanganan khusus", { exact: true }).click();
  await page.getByRole("button", { name: "Lepas tahanan booking", exact: true }).click();
  await page.getByLabel("Referensi konfirmasi").fill("JUBELIO-ATTEMPT-1");
  await page.getByLabel("Alasan / ringkasan konfirmasi").fill("Jubelio confirmed absence and closure for attempt 1");
  const confirm = page.getByRole("button", { name: "Konfirmasi rilis", exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Jubelio mengonfirmasi booking tidak terbentuk untuk percobaan ini.").check();
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Jubelio mengonfirmasi operasi permintaan awal untuk percobaan ini sudah ditutup.").check();
  await confirm.click();
  await expect(page.getByRole("region", { name: "Langkah berikutnya" })).toContainText("Booking sebelumnya tidak terbentuk. Pesan pengiriman.");
  expect(writes).toEqual([{ action: "release-booking", body: { proof: { source: "jubelio_confirmation", reference: "JUBELIO-ATTEMPT-1", reason: "Jubelio confirmed absence and closure for attempt 1", attemptNumber: 1, absenceConfirmed: true, operationClosed: true } } }]);
  await page.getByRole("button", { name: "Pesan pengiriman", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Konfirmasi mengirim permintaan booking ke provider.");
  expect(writes).toHaveLength(1);
});

test("readiness confirmation does not book shipment and its result drives persistent guidance", async ({ page }) => {
  let ready = false; const posts: string[] = [];
  await page.route(`**/api/admin/orders/${id}`, (route) => route.fulfill({ json: { success: true, data: ready ? fixture : { ...fixture, shipment: null, workflow: { ...fixture.workflow, stage: { label: "Siapkan barang", guidance: "Siapkan barang, lalu tandai siap.", terminal: false } } } } }));
  await page.route(`**/api/admin/orders/${id}/delivery/*`, (route) => { posts.push(route.request().url().split("/").pop()!); ready = true; return route.fulfill({ json: { success: true } }); });
  await page.goto(`/admin/orders/${id}`);
  await page.getByRole("button", { name: "Tandai siap", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Pengiriman belum dipesan.");
  expect(posts).toEqual([]);
  await page.getByRole("dialog").getByRole("button", { name: "Tandai siap", exact: true }).click();
  await expect(page.getByText("Barang ditandai siap.", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Langkah berikutnya" })).toContainText("Barang siap. Pesan pengiriman.");
  expect(posts).toEqual(["packing"]);
});

test("packing failure confirmation explains all unchanged commercial consequences", async ({ page }) => {
  await page.route(`**/api/admin/orders/${id}`, (route) => route.fulfill({ json: { success: true, data: fixture } }));
  await page.goto(`/admin/orders/${id}`);
  await page.getByText("Penanganan khusus", { exact: true }).click();
  await page.getByRole("button", { name: "Laporkan kendala barang", exact: true }).click();
  await page.getByRole("option", { name: "Barang rusak", exact: true }).click();
  await expect(page.getByText("Order tetap dalam proses dan pembayaran tetap lunas.")).toBeVisible();
  await expect(page.getByText(/Tindakan ini tidak melakukan refund, membatalkan SO/)).toBeVisible();
});

test("handoff reviews actual transfer, and courier activity keeps absent event time distinct from receipt time and costs", async ({ page }) => {
  await page.route(`**/api/admin/orders/${id}`, (route) => route.fulfill({ json: { success: true, data: {
    ...fixture, shipment: { state: "booked", awb: "FIXTURE-AWB", quoteRates: "20000", bookedPrice: "25000", billedPrice: null, latestStatus: "WAITING", bookedAt: "2026-05-01T09:00:00Z" },
    workflow: { ...fixture.workflow, stage: { label: "Menunggu penjemputan", guidance: "Tunggu kurir. Catat serah terima setelah barang diserahkan.", terminal: false }, tracking: { handoff: true, reconcile: true } },
    trackingTimeline: [{ id: "receipt", applied: true, source: "webhook", latestStatus: "WAITING", receivedAt: "2026-05-01T10:00:00Z", providerEventAt: null }],
  } } }));
  await page.goto(`/admin/orders/${id}`);
  await expect(page.getByRole("region", { name: "Keuangan pengiriman" })).toContainText("Rp 20.000");
  await expect(page.getByRole("region", { name: "Keuangan pengiriman" })).toContainText("Rp 25.000");
  await expect(page.getByRole("region", { name: "Keuangan pengiriman" })).toContainText("Belum ada tagihan");
  await expect(page.getByRole("region", { name: "Activity delivery" })).toContainText("Waktu kejadian: Belum tersedia");
  await expect(page.getByRole("region", { name: "Activity delivery" })).toContainText("Update diterima sistem:");
  await page.getByRole("button", { name: "Catat serah terima", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("FIXTURE-AWB");
  await expect(page.getByRole("dialog")).toContainText("Ini bukan bukti barang diterima pelanggan.");
  await page.getByRole("dialog").getByRole("button", { name: "Batal" }).click();
  await expect(page.getByRole("button", { name: "Catat serah terima", exact: true })).toBeFocused();
});

test("booking review separates goods, destination, shipping and cautions on desktop and mobile without submitting on dismissal", async ({ page }) => {
  const posts: string[] = [];
  await page.route(`**/api/admin/orders/${id}`, (route) => route.fulfill({ json: { success: true, data: {
    ...fixture, items: [
      { ...fixture.items[0], variantInfo: "Size 42" },
      { ...fixture.items[0], id: "second-item", productName: "Second goods", variantInfo: null, quantity: 1 },
    ],
  } } }));
  await page.route(`**/api/admin/orders/${id}/delivery/*`, (route) => {
    posts.push(route.request().url());
    return route.fulfill({ json: { success: true } });
  });
  await page.goto(`/admin/orders/${id}`);
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const opener = page.getByRole("button", { name: "Pesan pengiriman", exact: true });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Pesan pengiriman?" });
    const goods = dialog.getByRole("region", { name: "Barang" });
    const destination = dialog.getByRole("region", { name: "Tujuan pengiriman" });
    const shipping = dialog.getByRole("region", { name: "Layanan pengiriman" });
    await expect(goods).toContainText("Frozen goods");
    await expect(goods).toContainText("Size 42");
    await expect(goods).toContainText("Jumlah 2");
    await expect(goods).toContainText("Second goods");
    await expect(destination).toContainText("Frozen Recipient");
    await expect(destination).toContainText("0800000000");
    await expect(destination).toContainText("Frozen Destination");
    await expect(destination).toContainText("12345");
    await expect(shipping).toContainText("Frozen Courier REG");
    await expect(shipping).toContainText("Rp 20.000");
    for (const section of [goods, destination, shipping]) {
      await expect(section).toHaveCSS("border-top-style", "solid");
      await expect(section).toHaveCSS("border-top-width", "1px");
    }
    const caution = dialog.getByRole("note", { name: "Sebelum memesan" });
    await expect(caution).toContainText("Booking belum berarti barang diserahkan ke kurir.");
    await expect(caution).toContainText("Jika hasil belum pasti, jangan pesan ulang.");
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const cancel = dialog.getByRole("button", { name: "Batal", exact: true });
    await cancel.scrollIntoViewIfNeeded();
    await expect(cancel).toBeInViewport();
    await cancel.click();
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();
  }
  expect(posts).toEqual([]);
});

test("booking requires frozen review, blocks duplicates, and a failed reload never enables another write", async ({ page }) => {
  let submitted = false; let posts = 0;
  await page.route(`**/api/admin/orders/${id}`, (route) => submitted ? route.abort() : route.fulfill({ json: { success: true, data: fixture } }));
  await page.route(`**/api/admin/orders/${id}/delivery/book`, async (route) => {
    posts++; submitted = true;
    await route.fulfill({ json: { success: true, data: { status: "booked" } } });
  });
  await page.goto(`/admin/orders/${id}`);
  await page.getByRole("button", { name: "Pesan pengiriman", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Frozen goods");
  await expect(dialog).toContainText("Frozen Recipient");
  await expect(dialog).toContainText("Frozen Destination");
  await expect(dialog).toContainText("Frozen Courier REG");
  await expect(dialog).toContainText("Rp 20.000");
  await expect(dialog).toContainText("Jika hasil belum pasti, jangan pesan ulang.");
  await dialog.getByRole("button", { name: "Pesan pengiriman", exact: true }).click();
  await expect(page.getByText("Detail belum berhasil diperbarui. Muat ulang detail untuk memastikan hasil.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pesan pengiriman", exact: true })).toHaveCount(0);
  expect(posts).toBe(1);
});
