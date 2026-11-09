/**
 * Template email delivery (spec §5.1) — tiga pasangan HTML/plain-text dengan
 * token brand existing (`email-config.ts`). Tidak ada pickup date/time/kode
 * pickup di sini: penerima delivery tidak pernah menerima instruksi
 * pengambilan.
 *
 * Ringkasan memakai data order/snapshot TERSIMPAN (tidak pernah reprice) dan
 * tidak menampilkan alasan internal penutupan manual.
 */

import {
  BRAND_NAME,
  BRAND_PRIMARY,
  BRAND_SUPPORT_EMAIL,
} from "@/lib/email-config";
import type { OrderEmailContent } from "@marketplace/db/src/order-communications/order-communication-contract";

export type DeliveryEmailKind =
  | "delivery_ready"
  | "delivery_in_transit"
  | "delivery_delivered";

export interface DeliveryEmailItem {
  productName: string;
  variantInfo: string | null;
  price: string;
  quantity: number;
}

export interface DeliveryEmailDestination {
  recipientName: string;
  phone: string;
  fullAddress: string;
  city: string;
  province: string;
  postalCode: string;
}

export interface DeliveryEmailOrder {
  id: string;
  contactEmail: string;
  items: DeliveryEmailItem[];
  subtotal: string;
  shippingCost: string;
  serviceFee: string;
  ppnRate: string;
  ppnAmount: string;
  total: string;
  branch: { name: string; city: string; address: string } | null;
  destination: DeliveryEmailDestination | null;
  serviceName: string | null;
}

const COPY: Record<
  DeliveryEmailKind,
  { subject: string; heading: string; core: string; cta: string }
> = {
  delivery_ready: {
    subject: "Pembayaran diterima — pesanan sedang disiapkan",
    heading: "Pembayaran diterima — pesanan sedang disiapkan",
    core:
      "Pembayaran untuk order #{nomor} telah diterima. Pesanan Anda sedang disiapkan untuk pengiriman.",
    cta: "Lihat pesanan",
  },
  delivery_in_transit: {
    subject: "Pesanan sedang diantar",
    heading: "Pesanan sedang diantar",
    core:
      "Pesanan Anda sudah diserahkan kepada kurir untuk diantar ke alamat tujuan. Pantau perkembangannya melalui detail pesanan.",
    cta: "Lacak pesanan",
  },
  delivery_delivered: {
    subject: "Pesanan sudah sampai",
    heading: "Pesanan sudah sampai",
    core:
      "Menurut informasi kurir, pesanan Anda sudah diterima. Terima kasih telah berbelanja.",
    cta: "Lihat pesanan",
  },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function rupiah(amount: string): string {
  const parsed = Number.parseFloat(amount);
  if (!Number.isFinite(parsed)) return "Rp 0";
  return `Rp ${parsed.toLocaleString("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function shortId(orderId: string): string {
  return orderId.slice(0, 8).toUpperCase();
}

function itemLines(order: DeliveryEmailOrder): string[] {
  return order.items.map((item) => {
    const variant = item.variantInfo ? ` (${item.variantInfo})` : "";
    return `${item.quantity}× ${item.productName}${variant} — ${rupiah(item.price)}`;
  });
}

function moneyLines(order: DeliveryEmailOrder): string[] {
  const lines = [`Subtotal: ${rupiah(order.subtotal)}`];
  if (Number.parseFloat(order.shippingCost) > 0) {
    lines.push(`Ongkos kirim: ${rupiah(order.shippingCost)}`);
  }
  if (Number.parseFloat(order.serviceFee) > 0) {
    lines.push(`Biaya layanan: ${rupiah(order.serviceFee)}`);
  }
  if (Number.parseFloat(order.ppnAmount) > 0) {
    lines.push(`PPN ${order.ppnRate}%: ${rupiah(order.ppnAmount)}`);
  }
  lines.push(`Total: ${rupiah(order.total)}`);
  return lines;
}

function destinationLines(order: DeliveryEmailOrder): string[] {
  if (!order.destination) return [];
  const destination = order.destination;
  return [
    `${destination.recipientName} — ${destination.phone}`,
    destination.fullAddress,
    `${destination.city}, ${destination.province} ${destination.postalCode}`,
    ...(order.serviceName ? [`Layanan: ${order.serviceName}`] : []),
  ];
}

function originLine(order: DeliveryEmailOrder): string {
  return order.branch
    ? `Dikirim dari ${order.branch.name} — ${order.branch.city}`
    : "";
}

/** Render email delivery (HTML + plain text) dengan copy final spec §5.1. */
export function renderDeliveryOrderEmail(input: {
  kind: DeliveryEmailKind;
  order: DeliveryEmailOrder;
  orderUrl: string;
}): OrderEmailContent {
  const { kind, order, orderUrl } = input;
  const copy = COPY[kind];
  const number = shortId(order.id);
  const core = copy.core.replace("{nomor}", number);
  const year = new Date().getFullYear();

  const htmlSections = [
    `<h1 style="margin:0 0 16px;font-size:22px;color:${BRAND_PRIMARY};">${escapeHtml(copy.heading)}</h1>`,
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1f2937;">${escapeHtml(core)}</p>`,
    `<p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#111827;">Order #${escapeHtml(number)}</p>`,
    `<ul style="margin:0 0 16px;padding-left:18px;font-size:14px;line-height:1.6;color:#1f2937;">${itemLines(order)
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join("")}</ul>`,
    `<ul style="margin:0 0 16px;padding-left:18px;font-size:14px;line-height:1.6;color:#1f2937;list-style:none;">${moneyLines(
      order
    )
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join("")}</ul>`,
    destinationLines(order).length > 0
      ? `<div style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#1f2937;"><p style="margin:0 0 4px;font-weight:600;">Tujuan pengiriman</p>${destinationLines(
          order
        )
          .map((line) => `<p style="margin:0;">${escapeHtml(line)}</p>`)
          .join("")}</div>`
      : "",
    originLine(order)
      ? `<p style="margin:0 0 20px;font-size:13px;color:#4b5563;">${escapeHtml(originLine(order))}</p>`
      : "",
    `<a href="${escapeHtml(orderUrl)}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">${escapeHtml(
      copy.cta
    )}</a>`,
  ];

  const html = `<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(
    copy.subject
  )}</title></head>
<body style="margin:0;padding:24px;background:#f3f4f6;font-family:Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;">
    <tr><td style="padding:24px 24px 8px;">
      <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:${BRAND_PRIMARY};">${escapeHtml(
        BRAND_NAME
      )}</p>
      ${htmlSections.join("\n      ")}
    </td></tr>
    <tr><td style="padding:16px 24px 24px;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7280;">Email ini dikirim ke alamat yang tersimpan pada order Anda. Butuh bantuan? Hubungi ${escapeHtml(
        BRAND_SUPPORT_EMAIL
      )}.</p>
      <p style="margin:8px 0 0;font-size:12px;color:#9ca3af;">&copy; ${year} ${escapeHtml(
        BRAND_NAME
      )}</p>
    </td></tr>
  </table>
</body>
</html>`;

  const textLines = [
    BRAND_NAME,
    copy.heading,
    "",
    core,
    "",
    `Order #${number}`,
    "",
    ...itemLines(order),
    "",
    ...moneyLines(order),
    ...(destinationLines(order).length > 0
      ? ["", "Tujuan pengiriman:", ...destinationLines(order)]
      : []),
    ...(originLine(order) ? ["", originLine(order)] : []),
    "",
    `${copy.cta}: ${orderUrl}`,
    "",
    `Butuh bantuan? Hubungi ${BRAND_SUPPORT_EMAIL}.`,
  ];

  return {
    to: order.contactEmail,
    subject: `${copy.subject} — #${number}`,
    html,
    text: textLines.join("\n"),
  };
}
