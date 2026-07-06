import {
  BRAND_PRIMARY,
  BRAND_NAME,
  BRAND_SUPPORT_EMAIL,
} from "@/lib/email-config";
import type { OperatingHours } from "@/db";

// ===== Types =====
export interface OrderItemForEmail {
  productName: string;
  variantInfo: string | null;
  price: string;
  quantity: number;
}

export interface OrderForEmail {
  id: string;
  total: string;
  subtotal: string;
  serviceFee: string;
  contactName?: string;
  pickupDate: Date | null;
  pickupTime: string | null;
}

export interface BranchForEmail {
  name: string;
  address: string;
  city: string;
  operatingHours: OperatingHours;
}

interface PickupReadyEmailProps {
  order: OrderForEmail;
  pickupCode: string;
  branch: BranchForEmail;
  items: OrderItemForEmail[];
}

interface OrderCompletedEmailProps {
  order: OrderForEmail;
  items: OrderItemForEmail[];
}

// ===== Email #1: Order Ready for Pickup =====

export function pickupReadyEmailHTML({
  order,
  pickupCode,
  branch,
  items,
}: PickupReadyEmailProps): string {
  const year = new Date().getFullYear();
  const shortId = order.id.slice(0, 8).toUpperCase();
  const pickupDateLabel = order.pickupDate
    ? new Date(order.pickupDate).toLocaleDateString("id-ID", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "-";

  const itemsRows = items
    .map(
      (item) => `            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #e4e4e7;font-size:14px;color:#3f3f46;">
                ${escapeHtml(item.productName)}
                ${item.variantInfo ? `<br/><span style="font-size:12px;color:#71717a;">${escapeHtml(item.variantInfo)}</span>` : ""}
              </td>
              <td style="padding:10px 12px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#3f3f46;text-align:center;">${item.quantity}</td>
              <td style="padding:10px 0;border-bottom:1px solid #e4e4e7;font-size:14px;color:#18181b;text-align:right;font-weight:500;">
                Rp ${formatRupiah(parseFloat(item.price) * item.quantity)}
              </td>
            </tr>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="id">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Your Order is Ready for Pickup</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
            <!-- Header -->
            <tr>
              <td style="padding:32px 40px 8px 40px;text-align:left;">
                <span style="font-size:20px;font-weight:700;letter-spacing:-0.01em;color:${BRAND_PRIMARY};">${escapeHtml(BRAND_NAME)}</span>
              </td>
            </tr>
            <!-- Body -->
            <tr>
              <td style="padding:16px 40px 24px 40px;">
                <h1 style="margin:0 0 16px 0;font-size:22px;line-height:28px;font-weight:700;color:#18181b;">Pesanan Siap untuk Pickup</h1>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:24px;color:#3f3f46;">Pembayaran Anda telah berhasil diterima. Pesanan Anda telah disiapkan dan siap untuk diambil.</p>

                <!-- Pickup Code -->
                <div style="margin:0 0 28px 0;padding:24px;text-align:center;background-color:#f4f4f5;border-radius:12px;border:2px dashed ${BRAND_PRIMARY};">
                  <p style="margin:0 0 8px 0;font-size:13px;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;">Kode Pickup Anda</p>
                  <p style="margin:0;font-family:'Courier New',Courier,monospace;font-size:36px;font-weight:700;letter-spacing:0.15em;color:${BRAND_PRIMARY};">${escapeHtml(pickupCode)}</p>
                </div>

                <!-- Order items -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
                  <thead>
                    <tr>
                      <th style="padding:8px 0;font-size:12px;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;text-align:left;border-bottom:2px solid #e4e4e7;">Produk</th>
                      <th style="padding:8px 12px;font-size:12px;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;text-align:center;border-bottom:2px solid #e4e4e7;">Qty</th>
                      <th style="padding:8px 0;font-size:12px;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;text-align:right;border-bottom:2px solid #e4e4e7;">Harga</th>
                    </tr>
                  </thead>
                  <tbody>
${itemsRows}
                  </tbody>
                </table>

                <!-- Total -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px 0;">
                  <tr>
                    <td style="padding:4px 0;font-size:14px;color:#71717a;">Subtotal</td>
                    <td style="padding:4px 0;font-size:14px;color:#3f3f46;text-align:right;">Rp ${formatRupiah(parseFloat(order.subtotal))}</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;font-size:14px;color:#71717a;">Biaya Layanan</td>
                    <td style="padding:4px 0;font-size:14px;color:#3f3f46;text-align:right;">Rp ${formatRupiah(parseFloat(order.serviceFee))}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0 0 0;font-size:16px;font-weight:700;color:#18181b;border-top:1px solid #e4e4e7;">Total</td>
                    <td style="padding:12px 0 0 0;font-size:16px;font-weight:700;color:${BRAND_PRIMARY};text-align:right;border-top:1px solid #e4e4e7;">Rp ${formatRupiah(parseFloat(order.total))}</td>
                  </tr>
                </table>

                <!-- Branch info -->
                <div style="margin:0 0 24px 0;padding:20px;background-color:#f4f4f5;border-radius:8px;">
                  <p style="margin:0 0 8px 0;font-size:13px;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;">Lokasi Pickup</p>
                  <p style="margin:0 0 4px 0;font-size:15px;font-weight:600;color:#18181b;">${escapeHtml(branch.name)}</p>
                  <p style="margin:0 0 4px 0;font-size:14px;color:#3f3f46;">${escapeHtml(branch.address)}, ${escapeHtml(branch.city)}</p>
                  <p style="margin:8px 0 0 0;font-size:13px;color:#71717a;"><strong>Waktu Pickup:</strong> ${pickupDateLabel} pukul ${order.pickupTime || "-"}</p>
                </div>

                <!-- Instructions -->
                <div style="margin:0 0 24px 0;padding:16px;background-color:#ecfdf5;border-radius:8px;border:1px solid #d1fae5;">
                  <p style="margin:0;font-size:14px;color:#065f46;">Tunjukkan kode pickup di atas kepada staf cabang saat Anda tiba untuk mengambil pesanan.</p>
                </div>
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="padding:24px 40px 32px 40px;border-top:1px solid #e4e4e7;">
                <p style="margin:0 0 8px 0;font-size:13px;line-height:20px;color:#71717a;">ID Pesanan: ${escapeHtml(shortId)}</p>
                <p style="margin:0;font-size:13px;line-height:20px;color:#a1a1aa;">${escapeHtml(BRAND_NAME)} &middot; ${year}<br />${escapeHtml(BRAND_SUPPORT_EMAIL)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function pickupReadyEmailText({
  order,
  pickupCode,
  branch,
  items,
}: PickupReadyEmailProps): string {
  const shortId = order.id.slice(0, 8).toUpperCase();
  const pickupDateLabel = order.pickupDate
    ? new Date(order.pickupDate).toLocaleDateString("id-ID", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "-";

  const itemsText = items
    .map(
      (item) =>
        `  - ${item.productName}${item.variantInfo ? ` (${item.variantInfo})` : ""} ×${item.quantity} — Rp ${formatRupiah(parseFloat(item.price) * item.quantity)}`
    )
    .join("\n");

  return `Pesanan Siap untuk Pickup — #${shortId}

Pembayaran Anda telah berhasil diterima.

KODE PICKUP ANDA: ${pickupCode}

Pesanan:
${itemsText}

Subtotal: Rp ${formatRupiah(parseFloat(order.subtotal))}
Biaya Layanan: Rp ${formatRupiah(parseFloat(order.serviceFee))}
Total: Rp ${formatRupiah(parseFloat(order.total))}

Lokasi Pickup:
${branch.name}
${branch.address}, ${branch.city}

Waktu Pickup: ${pickupDateLabel} pukul ${order.pickupTime || "-"}

Tunjukkan kode pickup di atas kepada staf cabang saat Anda tiba.

${BRAND_NAME} · ${BRAND_SUPPORT_EMAIL}`;
}

// ===== Email #2: Order Completed =====

export function orderCompletedEmailHTML({
  order,
  items,
}: OrderCompletedEmailProps): string {
  const year = new Date().getFullYear();
  const shortId = order.id.slice(0, 8).toUpperCase();
  const completedAt = new Date().toLocaleString("id-ID", {
    dateStyle: "long",
    timeStyle: "short",
  });

  const itemsRows = items
    .map(
      (item) => `            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #e4e4e7;font-size:14px;color:#3f3f46;">
                ${escapeHtml(item.productName)}
                ${item.variantInfo ? `<br/><span style="font-size:12px;color:#71717a;">${escapeHtml(item.variantInfo)}</span>` : ""}
              </td>
              <td style="padding:10px 12px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#3f3f46;text-align:center;">${item.quantity}</td>
              <td style="padding:10px 0;border-bottom:1px solid #e4e4e7;font-size:14px;color:#18181b;text-align:right;font-weight:500;">
                Rp ${formatRupiah(parseFloat(item.price) * item.quantity)}
              </td>
            </tr>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="id">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Your Order has been Completed</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
            <tr>
              <td style="padding:32px 40px 8px 40px;text-align:left;">
                <span style="font-size:20px;font-weight:700;letter-spacing:-0.01em;color:${BRAND_PRIMARY};">${escapeHtml(BRAND_NAME)}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 40px 24px 40px;">
                <h1 style="margin:0 0 16px 0;font-size:22px;line-height:28px;font-weight:700;color:#18181b;">Pesanan Selesai</h1>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:24px;color:#3f3f46;">Terima kasih telah berbelanja dengan kami! Pesanan Anda telah berhasil diselesaikan.</p>

                <div style="margin:0 0 24px 0;padding:16px;background-color:#ecfdf5;border-radius:8px;border:1px solid #d1fae5;">
                  <p style="margin:0;font-size:14px;color:#065f46;"><strong>Diselesaikan pada:</strong> ${escapeHtml(completedAt)}</p>
                </div>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
                  <thead>
                    <tr>
                      <th style="padding:8px 0;font-size:12px;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;text-align:left;border-bottom:2px solid #e4e4e7;">Produk</th>
                      <th style="padding:8px 12px;font-size:12px;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;text-align:center;border-bottom:2px solid #e4e4e7;">Qty</th>
                      <th style="padding:8px 0;font-size:12px;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;text-align:right;border-bottom:2px solid #e4e4e7;">Harga</th>
                    </tr>
                  </thead>
                  <tbody>
${itemsRows}
                  </tbody>
                </table>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px 0;">
                  <tr>
                    <td style="padding:12px 0 0 0;font-size:16px;font-weight:700;color:#18181b;border-top:1px solid #e4e4e7;">Total</td>
                    <td style="padding:12px 0 0 0;font-size:16px;font-weight:700;color:${BRAND_PRIMARY};text-align:right;border-top:1px solid #e4e4e7;">Rp ${formatRupiah(parseFloat(order.total))}</td>
                  </tr>
                </table>

                <p style="margin:0;font-size:15px;line-height:24px;color:#3f3f46;">Sampai jumpa di pesanan berikutnya! Terima kasih telah memilih ${escapeHtml(BRAND_NAME)}.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 40px 32px 40px;border-top:1px solid #e4e4e7;">
                <p style="margin:0 0 8px 0;font-size:13px;line-height:20px;color:#71717a;">ID Pesanan: ${escapeHtml(shortId)}</p>
                <p style="margin:0;font-size:13px;line-height:20px;color:#a1a1aa;">${escapeHtml(BRAND_NAME)} &middot; ${year}<br />${escapeHtml(BRAND_SUPPORT_EMAIL)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function orderCompletedEmailText({
  order,
  items,
}: OrderCompletedEmailProps): string {
  const shortId = order.id.slice(0, 8).toUpperCase();
  const completedAt = new Date().toLocaleString("id-ID", {
    dateStyle: "long",
    timeStyle: "short",
  });

  const itemsText = items
    .map(
      (item) =>
        `  - ${item.productName}${item.variantInfo ? ` (${item.variantInfo})` : ""} ×${item.quantity} — Rp ${formatRupiah(parseFloat(item.price) * item.quantity)}`
    )
    .join("\n");

  return `Pesanan Selesai — #${shortId}

Terima kasih telah berbelanja dengan kami!

Diselesaikan pada: ${completedAt}

Pesanan:
${itemsText}

Total: Rp ${formatRupiah(parseFloat(order.total))}

Sampai jumpa di pesanan berikutnya!

${BRAND_NAME} · ${BRAND_SUPPORT_EMAIL}`;
}

// ===== Helpers =====

function formatRupiah(amount: number): string {
  return amount.toLocaleString("id-ID");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}