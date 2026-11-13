import { describe, expect, it } from "vitest";
import { renderDeliveryOrderEmail } from "./delivery-email-templates";

/**
 * Template email delivery (spec §5.1). Expected values diambil dari copy final
 * spec dan aturan kebijakan — tidak memanggil helper produksi untuk menentukan
 * nilai yang diharapkan.
 */

const baseOrder = {
  id: "order-delivery-email-fixture",
  contactEmail: "penerima@example.test",
  items: [
    {
      productName: 'Sepatu <Trail> & "Running"',
      variantInfo: "42 / Hitam",
      price: "250000",
      quantity: 2,
    },
  ],
  subtotal: "500000",
  shippingCost: "20000",
  serviceFee: "5000",
  ppnRate: "11",
  ppnAmount: "57750",
  total: "582750",
  branch: {
    name: "Cabang Utama",
    city: "Bandung",
    address: "Jl. Asia Afrika 1",
  },
  destination: {
    recipientName: "Budi Penerima",
    phone: "081200000000",
    fullAddress: "Jl. Tujuan No. 7",
    city: "Jakarta Selatan",
    province: "DKI Jakarta",
    postalCode: "12140",
  },
  serviceName: "JNE REG",
};

const orderUrl = "http://localhost:3000/account/orders/order-delivery-email-fixture";

describe("renderDeliveryOrderEmail (copy final spec §5.1)", () => {
  it("ready: subjek dan isi tidak mengklaim barang sudah dibawa kurir", () => {
    const email = renderDeliveryOrderEmail({
      kind: "delivery_ready",
      order: baseOrder,
      orderUrl,
    });
    expect(email.subject).toContain("Pembayaran diterima — pesanan sedang disiapkan");
    expect(email.subject).toContain("#ORDER-DE");
    expect(email.text).toContain(
      "Pembayaran untuk order #ORDER-DE telah diterima. Pesanan Anda sedang disiapkan untuk pengiriman."
    );
    expect(email.text).not.toMatch(/sudah diterima/i);
    expect(email.text).not.toMatch(/diantar ke alamat tujuan\./i);
    expect(email.html).toContain("Lihat pesanan");
    expect(email.html).toContain(orderUrl);
    expect(email.text).toContain(`Lihat pesanan: ${orderUrl}`);
  });

  it("in_transit memakai CTA Lacak pesanan dan tetap menunjuk detail order storefront", () => {
    const email = renderDeliveryOrderEmail({
      kind: "delivery_in_transit",
      order: baseOrder,
      orderUrl,
    });
    expect(email.subject).toContain("Pesanan sedang diantar");
    expect(email.text).toContain(
      "Pesanan Anda sudah diserahkan kepada kurir untuk diantar ke alamat tujuan."
    );
    expect(email.html).toContain("Lacak pesanan");
    expect(email.html).toContain(orderUrl);
    expect(email.html).not.toContain("/admin/");
  });

  it("delivered memakai copy sudah sampai tanpa alasan internal penutupan manual", () => {
    const email = renderDeliveryOrderEmail({
      kind: "delivery_delivered",
      order: baseOrder,
      orderUrl,
    });
    expect(email.subject).toContain("Pesanan sudah sampai");
    expect(email.text).toContain(
      "Menurut informasi kurir, pesanan Anda sudah diterima. Terima kasih telah berbelanja."
    );
    expect(email.text).not.toMatch(/selesai manual|penutupan manual|manual finish/i);
  });

  it("template delivery tidak pernah memuat kode atau jadwal pickup", () => {
    const email = renderDeliveryOrderEmail({
      kind: "delivery_ready",
      order: baseOrder,
      orderUrl,
    });
    expect(email.html.toLowerCase()).not.toContain("pickup");
    expect(email.text.toLowerCase()).not.toContain("pickup");
    expect(email.text).not.toMatch(/ambil di/i);
  });

  it("meringkas item, uang, cabang asal, tujuan dan layanan tersimpan", () => {
    const email = renderDeliveryOrderEmail({
      kind: "delivery_ready",
      order: baseOrder,
      orderUrl,
    });
    expect(email.text).toContain("2× Sepatu <Trail> & \"Running\" (42 / Hitam)");
    expect(email.text).toContain("Subtotal: Rp 500.000");
    expect(email.text).toContain("Ongkos kirim: Rp 20.000");
    expect(email.text).toContain("Biaya layanan: Rp 5.000");
    expect(email.text).toContain("PPN 11%: Rp 57.750");
    expect(email.text).toContain("Total: Rp 582.750");
    expect(email.text).toContain("Dikirim dari Cabang Utama — Bandung");
    expect(email.text).toContain("Budi Penerima — 081200000000");
    expect(email.text).toContain("Jl. Tujuan No. 7");
    expect(email.text).toContain("Layanan: JNE REG");
  });

  it("meng-escape nama item dan alamat pada HTML", () => {
    const email = renderDeliveryOrderEmail({
      kind: "delivery_in_transit",
      order: baseOrder,
      orderUrl,
    });
    expect(email.html).toContain("Sepatu &lt;Trail&gt; &amp; &quot;Running&quot;");
    expect(email.html).not.toContain("<Trail>");
  });

  it("mengirim ke contactEmail order yang tersimpan", () => {
    const email = renderDeliveryOrderEmail({
      kind: "delivery_ready",
      order: baseOrder,
      orderUrl,
    });
    expect(email.to).toBe("penerima@example.test");
  });
});
