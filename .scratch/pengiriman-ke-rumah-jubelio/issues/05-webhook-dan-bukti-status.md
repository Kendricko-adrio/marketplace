# Webhook dan bukti status pengiriman

Type: research
Label: wayfinder:research
Status: resolved
Blocked by: 01
Parent: [Menuju spec pengiriman ke rumah via Jubelio Shipment yang siap ditinjau](../map.md)

## Question

Untuk Shipment pada tenant ini, bagaimana verifikasi `x-jubelio-signature` sebenarnya (termasuk raw body/encoding dan fixture signed), jaminan retry/ordering, bentuk event, semantik status delivered/returned/issue, dan batas rekonsiliasi `GET /shipments/awb/{awb}`? Nyatakan bukti yang diperoleh dan bagian yang tetap tak terkonfirmasi; jangan menyamakan callback Shipment dengan webhook Omnichannel.

**Revisi skop setelah riset dokumen (2026-09-27, lihat Hasil riset di bawah):** aspek signature (algoritma), retry/ordering, bentuk event, semantik status, dan rekonsiliasi sudah terjawab dari [`shipment-v1.8.md`](../../../docs/jubelio-api/shipment-v1.8.md) sebagai source of truth + keputusan pemilik + verifier repo. Sisa-sisa yang awalnya dicatat (fixture signed, event selain `"awb"`, sub-kode `RETURNED`/`SHIPMENT_ISSUE`, konfigurasi dashboard) **semua ditutup oleh keputusan pemilik 2026-09-27** — lihat bagian `Keputusan penutup pemilik` dan `Sisa terbuka … DITUTUP` di bawah. Draf uji: [usulan-uji-webhook.md](../usulan-uji-webhook.md).

Setiap request API butuh draf dan izin pemilik **sebelum request**; meminta fixture/vendor tidak mengizinkan pengujian endpoint lain. Subagen hanya setelah izin delegasi terpisah.

## Hasil riset (2026-09-27 — dokumen v1.8 sebagai source of truth, tanpa request API kecuali W0 lokal)

Klasifikasi bukti: **[D]** dokumen v1.8 (wajib diikuti), **[K]** keputusan pemilik, **[U]** bukti uji live/lapo, **[R]** bukti dari kode repo yang sudah live.

### 1. Verifikasi `x-jubelio-signature` — algoritma terjawab dari dokumen; fixture tetap dibutuhkan

- **[D]** PDF hlm. 21: header `x-jubelio-signature`; PDF memuat dua deskripsi yang bertentangan — prosa "stringify payload + secret lalu SHA-256" vs contoh Node.js `HMAC-SHA256(key = secret, message = payload + secret)` yang dibandingkan sebagai hex. Keduanya **tidak setara**.
- **[D]** Direktif normatif yang wajib diikuti dari dokumen: verifikasi server-side **sebelum mutasi state**; **jangan reserialisasi JSON sebelum verifikasi** (verifikasi terhadap raw body persis); **constant-time compare**; **dedupe + rekonsiliasi** setiap event.
- **[K]** Keputusan pemilik (no. 13): ikuti dokumentasi → **contoh kode HMAC-SHA256** (key = secret, message = payload + secret, hex).
- **[R]** Penguat kuat: receiver webhook Omnichannel yang sudah live di produksi (`apps/store/src/app/api/webhooks/jubelio/route.ts` + `apps/store/src/lib/jubelio-webhook.ts`) memverifikasi **persis algoritma contoh PDF** — `HMAC-SHA256(rawBody + secret, key = secret)`, hex 64, `timingSafeEqual`, dengan header alias `sign` / `webhook-signature` / `x-jubelio-signature`. Vendor sama memakai pola ini di Omnichannel secara live → sangat masuk akal Shipment memakai pola sama, tetapi Shipment sendiri **belum punya bukti live**.
- **[U]** W0 (lokal, tanpa API): verifier repo menerima fixture per algoritma PDF dan menolak semua varian salah (SHA-256 polos, HMAC tanpa `+secret`, body tamper, signature hilang/rusak); bukti bahwa verifikasi harus memakai **raw body persis** (reserialisasi yang mengubah byte membatalkan signature).
- ~~Sisa: algoritma belum terbukti *untuk Shipment*~~ — **ditutup keputusan pemilik 2026-09-27**: dokumentasi = source of truth, tidak butuh fixture; validasi saat event nyata pertama tetap praktik yang baik, bukan prasyarat. Encoding "stringify" sisi Jubelio tidak didokumentasikan — verifikasi memakai raw body persis sesuai direktif dokumen.

### 2. Jaminan retry/ordering — kontrak TIDAK memberi jaminan; desain tidak boleh bergantung

- **[D]** PDF hlm. 21 eksplisit: *"The PDF does not document webhook retries, replay protection, or ordering"*; hlm. 20–21: *"event types and redelivery policy are not specified"*. Karena dokumen = source of truth, **tidak ada jaminan retry maupun urutan** — ini jawaban final per kontrak, bukan ketidaktahuan.
- **[K]** Konsisten: keputusan pemilik no. 14 — terima semua event tanpa asumsi urutan.
- **Catatan kontras (jangan dicampur):** webhook **Omnichannel** (dist.yaml, live di repo) memang meretry ≤3× saat receiver 500; perilaku itu **tidak otomatis berlaku** untuk callback Shipment.
- **Implikasi desain:** receiver harus idempotent, dedupe (tidak ada event ID di kontrak → kunci dedupe berbasis `awb` + `latest_status`/entri tracking terakhir), toleran duplikat dan kedatangan tak berurutan; rekonsiliasi via GET AWB saat event masuk (reaktif — konsisten dengan keputusan no. 16: tanpa polling).

### 3. Bentuk event — satu event didokumentasikan (`"awb"`), schema tidak lengkap → parser toleran

- **[D]** PDF hlm. 20–21 — satu-satunya event yang didokumentasikan: `event: "awb"`. Field: `ref_no`, `awb`, `shipment_id`, `latest_status`, `courier` (`courier_id`, `courier_service_id`, `courier_name`, `courier_service_name`, `service_category_name`), `delivered_img_url`, `sign_img_url`, `live_tracking_url`, `tracking_url`, `pod_url`, `tracking` (`date`, `status`, `status_detail`).
- **[D]** Dokumen menegaskan contoh field **bukan schema lengkap** (*"not an exhaustive event schema"*) → receiver wajib toleran terhadap field/event tak dikenal (jangan menolak event karena field baru).
- **[D]+[U]** Dua kosakata status terkonfirmasi: `latest_status` ternormalisasi vs `tracking.status` kode kurir (contoh PDF `CNCL`; uji live P5 menunjukkan tracking ternormalisasi `CANCELED` pada AWB detail).

### 4. Semantik status delivered/returned/issue

- **[D]** PDF hlm. 9 & 20: enum `latest_status` 10 nilai muncul di **AWB detail dan webhook**: `WAITING`, `CONFIRMED_BY_COURIER`, `ON_THE_WAY_PICK_UP`, `PICKED_UP`, `ON_DELIVERY`, `ON_HOLD`, `DELIVERED`, `RETURNED`, `CANCELED`, `SHIPMENT_ISSUE`.
- **[D]** Aturan yang didokumentasikan: nilai tak dikenal harus dianggap mungkin; **jangan menyamakan `PICKED_UP` dengan `DELIVERED`**; tidak ada urutan transisi yang dijamin.
- **DELIVERED:** disertai metadata POD di payload (`delivered_img_url`, `sign_img_url`, `pod_url`).
- **RETURNED / SHIPMENT_ISSUE:** tidak ada sub-kode/keterangan di dokumen → **[K]** keputusan no. 17: ditampilkan mentah di admin untuk tindakan manual. Sisa: sub-kode (draf vendor no. 17) dan apakah status itu terminal — tidak didokumentasikan.
- **[U]** Bukti live sampai hari ini hanya `WAITING` dan `CANCELED` (P3/P5); `RETURNED`/`SHIPMENT_ISSUE` tidak dapat dibuat di mode mock.

### 5. Batas rekonsiliasi `GET /shipments/awb/{awb}`

- **[D]** PDF hlm. 5–9: Bearer; balikan `shipment_id`, `ref_no`, `awb`, `price`/`price_bill`, timestamp pickup/ETA, `latest_status`, alamat, `items[]`, `tracking[]{date, status, status_detail}`, URL image/tracking, metadata delivery; **field bisa `null`/kosong**.
- **[D]** Dokumen tidak mendefinisikan rate limit/retry; **tidak ada lookup by `ref_no`** → rekonsiliasi memang via AWB (dari payload webhook atau simpanan create).
- **[K]** Keputusan pemilik no. 16: rekonsiliasi **manual di admin, tanpa polling** → "batas rekonsiliasi" otomatis tidak lagi memengaruhi desain; GET AWB dipakai reaktif (saat event/admin), bukan cron.
- **[U]** GET AWB terbukti live dua kali (P3 `WAITING`, P5 `CANCELED` dengan `tracking[].status: "CANCELED"` ternormalisasi — bukan `CNCL`).
- **Sisa:** skema field lengkap belum direkam (W1 opsional); perilaku di kurir live menunggu aktivasi kurir.

### 6. Callback Shipment ≠ webhook Omnichannel — terkonfirmasi

- **[D]** Host terpisah (`api-shipment.*` vs `api2.jubelio.com`); README menegaskan bedanya.
- **[R]** Webhook Omnichannel live di repo memakai kosakata `action: update-product/update-price/update-qty` + header `Sign` — jelas berbeda dari callback Shipment (`event: "awb"`, `latest_status`). Receiver Shipment harus route sendiri, tidak boleh menimpa `/api/webhooks/jubelio` yang Omnichannel.

### Sisa terbuka tiket ini — DITUTUP oleh keputusan pemilik (2026-09-27)

1. ~~Fixture signed Shipment~~ — **Keputusan pemilik: dokumentasi official = source of truth.** Yang ada di dokumen diikuti tanpa menuntut bukti tambahan; validasi saat event nyata pertama tetap praktik yang baik, tapi **bukan prasyarat**.
2. ~~Konfigurasi webhook di dashboard tenant~~ — **Keputusan pemilik: bukan bagian tiket ini** (tindakan operasional pemilik, bukan pertanyaan riset; andalkan dokumentasi).
3. ~~Event lain selain `"awb"`~~ — dokumen menyatakan contoh bukan schema lengkap; desain toleran event tak dikenal; tidak perlu konfirmasi vendor.
4. Sub-kode `RETURNED`/`SHIPMENT_ISSUE` — tetap tampil mentah untuk tindakan manual (keputusan no. 17); konfirmasi vendor opsional, tidak menghalangi.
5. **Webhook akan diuji manual oleh pemilik** (setting sendiri); dari sisi aplikasi yang dibutuhkan sudah tersedia: receiver penangkap [shipment-webhook-catch.mjs](../shipment-webhook-catch.mjs) (teruji lokal) dan verifier `HMAC-SHA256(rawBody+secret)` yang sudah live di repo.

## Keputusan penutup pemilik (2026-09-27)

- **Dokumentasi official (`shipment-v1.8.md`) = source of truth; yang tertulis di sana diikuti tanpa menunggu bukti vendor tambahan.** Termasuk algoritma signature (contoh HMAC-SHA256) dan bentuk event.
- Konfigurasi dashboard webhook bukan pertanyaan riset tiket ini — tindakan pemilik, di luar skop.
- Pemilik akan menguji webhook secara manual sendiri nanti; yang penting **kodenya sudah tersedia** (receiver + verifier).
- Tiket ditutup: pertanyaan signature/retry-ordering/bentuk-event/semantik-status/rekonsiliasi terjawab dari dokumen + keputusan pemilik + bukti uji (W0 lokal, W1 live). Sisa perilaku kurir live (sub-kode, courier_price, frekuensi event) tidak menghalangi spec karena desain sudah toleran (idempotent, toleran event/field tak dikenal, rekonsiliasi GET AWB reaktif).

Draf uji terkait: [usulan-uji-webhook.md](../usulan-uji-webhook.md) — **W0 selesai** (lokal), **W1 selesai** (2026-09-27, izin pemilik), W2 menunggu prasyarat pemilik.

## Hasil W1 — skema rekonsiliasi `GET /shipments/awb/{awb}` penuh (2026-09-27, HTTP 200, read-only)

- **[U]** Struktur **flat** (bukan objek bersarang) dan jauh lebih kaya dari ringkasan transkripsi. **Field baru di luar transkripsi:** `courier_ref_no` (tanpa prefix `MOCK-`), `tracking_url_id`, `awb_generated_date`, `canceled_date`, **`canceled_by`** (`"USER"`), **`cancel_reason`** (echo alasan), `created_date`/`updated_date`, `discount_price`, **`courier_price=null`**, **`courier_weight=null`**, **`is_paid=false`**, `receipt_img_url`, seluruh field COD, `shipment_pick_url/date`, `is_draft`, `deleted_date`, `items[].depth`, dan **nama wilayah resolved** (`origin_province/city/district/area`).
- **[U]** Bukti tambahan semantik status: `CANCELED` disertai `cancel_reason` di root dan `tracking[].status_detail`; timeline tracking lengkap (`WAITING` → `CANCELED`) tersedia untuk rekonsiliasi admin tanpa endpoint lain.
- **[U]** `price=price_bill=7500`, `discount_price=0`, `shipping_insurance=null` pada booking tanpa asuransi (konsisten keputusan tiket 03); vendor memask sendiri sebagian PII di respons (`destination_address="Jl* U**"`, telepon tersamarkan).
- **[U]** **Format `tracking[].date` tidak seragam** (mikro+offset vs mili+offset) — parser wajib toleran; menguatkan prinsip "field/nilai di luar transkripsi diabaikan, bukan error".
- PII pada respons adalah data dummy uji P2 ("TEST DUMMY …"), tetap diredaksi di catatan.
- Bukti skema lengkap: [usulan-uji-webhook.md §Hasil W1](../usulan-uji-webhook.md).

## Status W2 — dialihkan ke uji manual pemilik (2026-09-27)

- Pemilik memutuskan webhook **diuji manual sendiri nanti** (setting + trigger sendiri); eksekusi W2 via sesi ini tidak diperlukan.
- Alat tetap tersedia dan teruji: [shipment-webhook-catch.mjs](../shipment-webhook-catch.mjs) (verifikasi sama dengan verifier repo; smoke test lokal lulus — event valid ✅ diterima, tanpa signature ditolak, semua event terekam).
- Kredensial Shipment di `.env` terbukti terbaca benar oleh skrip uji (catatan teknis: `.env` memakai CRLF — parser env harus split `\r?\n`).
