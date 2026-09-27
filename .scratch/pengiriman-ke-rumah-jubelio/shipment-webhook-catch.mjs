#!/usr/bin/env node
// Penerima webhook Jubelio Shipment untuk uji W2 (tiket 05).
// Zero-dependency. Jalankan di host publik:
//   SHIPMENT_WEBHOOK_SECRET=xxx PORT=8787 node shipment-webhook-catch.mjs
// Lalu daftarkan URL (mis. http://<host>:8787/shipment-webhook) di dashboard
// Shipment → Setting → Developer → Webhook, dan tunggu event saat uji W2.
// Setiap event dicatat ke ./shipment-webhook-events.jsonl (raw body + header
// signature) — fixture signed pertama untuk tiket 05.
import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 8787);
const SECRET = process.env.SHIPMENT_WEBHOOK_SECRET || "";
const OUT = process.env.OUT_FILE || "shipment-webhook-events.jsonl";

const verify = (raw, secret, provided) => {
  if (!provided) return { valid: false, reason: "missing" };
  if (!/^[a-f\d]{64}$/i.test(provided)) return { valid: false, reason: "malformed" };
  const expected = createHmac("sha256", secret).update(raw + secret).digest("hex");
  return { valid: timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex")), reason: "computed" };
};

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const headers = { ...req.headers };
    delete headers.cookie;
    const provided =
      headers["x-jubelio-signature"] || headers["sign"] || headers["webhook-signature"] || null;
    let verdict = "secret-belum-diset";
    if (SECRET) {
      const v = verify(raw, SECRET, provided);
      v.expectedPrefix = SECRET ? createHmac("sha256", SECRET).update(raw + SECRET).digest("hex").slice(0, 12) : null;
      v.providedPrefix = provided?.slice(0, 12) ?? null;
      v.bodyHashPrefix = createHash("sha256").update(raw).digest("hex").slice(0, 12);
      v.secretFingerprint = createHash("sha256").update(SECRET).digest("hex").slice(0, 12);
      v.bodyBytes = Buffer.byteLength(raw);
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} signature=${v.valid ? "VALID ✅" : `INVALID (${v.reason})`} header=${provided ? `x-jubelio-signature(${provided.length})` : "(tidak ada)"}`);
      var diag = v;
    } else {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} (secret belum diset — hanya merekam)`);
      var diag = { valid: null, reason: "no-secret" };
    }
    appendFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), url: req.url, headers, signature: diag, rawBody: raw }) + "\n");
    console.log(`  event: ${raw.slice(0, 200)}${raw.length > 200 ? " …" : ""}`);
    console.log(`  tersimpan → ${OUT}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
  });
});
server.listen(PORT, () =>
  console.log(`Receiver webhook Shipment aktif di :${PORT} — secret ${SECRET ? "diset (fingerprint tercatat di file event)" : "BELUM diset (rekam saja, tanpa verifikasi)"}`)
);