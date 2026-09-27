# Usulan uji webhook & rekonsiliasi Shipment (tiket 05 — W0 & W1 selesai; W2 dialihkan ke uji manual pemilik)

Status: **W0 (lokal) dan W1 (izin pemilik) sudah dijalankan 2026-09-27**; **W2 tidak dieksekusi via sesi ini** — pemilik memutuskan menguji webhook secara manual sendiri (setting + trigger sendiri); receiver tetap tersedia sebagai alat. Host: produksi `https://api-shipment.jubelio.com` (satu-satunya host yang mengenali kredensial tenant — mode mock). Rujukan: [`docs/jubelio-api/shipment-v1.8.md`](../../../docs/jubelio-api/shipment-v1.8.md) (source of truth — tertulis di sana diikuti tanpa butuh bukti vendor tambahan, keputusan pemilik), tiket [05](issues/05-webhook-dan-bukti-status.md) **resolved**.

Aturan yang sama seperti [usulan-uji-sandbox.md](usulan-uji-sandbox.md): token hanya di memori, tidak ada token/secret di log, output ke tiket diredaksi.

## W0 — Verifier signature vs algoritma dokumen (LOKAL, selesai 2026-09-27)

| Aspek | Isi |
|---|---|
| Tujuan | Membuktikan implementasi verifier aplikasi (`apps/store/src/lib/jubelio-webhook.ts` → `verifyJubelioSignature`) cocok dengan algoritma contoh Node.js di PDF hlm. 21: `HMAC-SHA256(key = secret, message = rawBody + secret)`, hex 64, timing-safe. |
| Metode | Skrip lokal `/tmp/w0-signature-test.mjs` + `/tmp/w0b-reserialize-test.mjs`; **tanpa panggilan API**; secret dummy (bukan credential). |
| Hasil | 7/7 semantika pass: fixture valid ✅; SHA-256 polos ditolak ✅; HMAC tanpa `+secret` ditolak ✅; body di-reserialize (byte berubah) ditolak ✅; hex uppercase diterima ✅; body tamper ditolak ✅; signature hilang/rusak ditolak ✅. |
| Artinya | Verifier yang sama bisa dipakai untuk callback Shipment (header `x-jubelio-signature` sudah termasuk alias yang dibaca). Yang **belum** dibuktikan: Jubelio Shipment benar-benar menandatangani dengan algoritma ini — itu butuh fixture vendor atau event nyata pertama (W2). |

## W1 — Rekam payload lengkap rekonsiliasi GET AWB (read-only, 1 request)

| Aspek | Isi |
|---|---|
| Tujuan | Dokumentasikan **bentuk penuh** payload `GET /shipments/awb/{awb}` sebagai sumber rekonsiliasi (tiket 05: batas rekonsiliasi): field yang bisa `null`, metadata delivery (POD/ETA/price_bill), dan bentuk `tracking[]` pada status CANCELED — bukti untuk spec status. |
| Metode & endpoint | `GET /shipments/awb/MOCK-JS2420810000000001` (AWB yang sudah ada dari uji P2/P4 — tidak membuat apa pun). |
| Body | Tidak ada. Bearer dari `POST /auth/generate-token`. |
| Langkah | 1) Token. 2) Satu GET. 3) Rekam struktur field (alamat diredaksi). |
| Bukti | Skema rekonsiliasi aktual di mode mock; melengkapi P3/P5 yang hanya mencatat status. |
| Risiko | Rendah. Read-only terhadap AWB yang sudah dibuat dan dibatalkan pada uji berizin sebelumnya. |
| Izin | ✅ diizinkan; dijalankan 2026-09-27 — **HTTP 200** (token 205 kar di memori saja). Hasil lengkap di tiket 05. |

### Hasil W1 (2026-09-27, HTTP 200)

**Skema aktual jauh lebih kaya dari ringkasan transkripsi — struktur *flat*, bukan objek bersarang:**

- Identitas: `shipment_id`, `ref_no`, **`courier_ref_no`** (baru: `JS2420810000000001` — tanpa prefix `MOCK-`), **`tracking_url_id`**, `awb`, `awb_generated_date` (ISO `Z`), `courier_id`/`courier_name`, `courier_service_id`/`courier_service_name`, `service_category_id`/`service_category_name` (`2`/`EKONOMI` — kategori live).
- Harga: `price=7500`, `price_bill=7500` (sama), **`discount_price=0`**, **`courier_price=null`**, **`courier_weight=null`**, **`is_paid=false`**, `shipping_insurance=null` (booking tanpa asuransi → null, konsisten keputusan tiket 03).
- Status & timeline: `latest_status="CANCELED"`, **`canceled_date`**, **`canceled_by="USER"`**, **`cancel_reason`** (echo alasan), **`created_date`**, **`updated_date`**, `pickup_timestamp`, `eta_from`/`eta_to` (ISO absolut), **`eta`** string manusiawi (`"27 September 2026"`), **`pickup_date=null`**, `delivered_date=null`.
- Alamat: **field *flat*** `origin_name|phone|email|address|coordinate|country|province_id|city_id|district_id|area_id|district_code|zipcode|note` + **nama wilayah resolved** (`origin_province/city/district/area`) — ID string, nol dijaga; vendor **memask sendiri** sebagian PII (`destination_address="Jl* U**"`, phone `************`).
- COD: `is_cod=null`, `cod_fee=0`, `cod_amount=null`, `cod_details={}`, `cod_rejected_reason=null`, `cod_confirmation_status=null`.
- Bukti visual/delivery: `receipt_img_url=null`, `delivered_img_url=null`, `sign_img_url=null`, `shipment_photo_url=null`, `shipment_pick_url=null`, `shipment_pick_date=null`.
- Lainnya: `is_draft=null`, `deleted_date=null`, `package_detail=null` (echo create), `is_insurance=false`.
- `items[]`: `{shipment_detail_id, shipment_id, item_name, item_code, category, weight (gram), length/width/height (cm), depth, quantity, value, is_fragile}` — `depth` baru.
- `tracking[]`: `{date, status, status_detail}` — 2 entri (`WAITING` → `CANCELED`, status_detail bahasa Indonesia, termasuk echo cancel_reason). **Format `date` tidak seragam**: entri-1 `2026-09-27T09:54:09.518972+00:00` (mikro+offset), entri-2 `2026-09-27T09:54:10.543+00:00` (mili+offset) → parser harus toleran.
- Meta kurir: `courier_logo` (URL), `tracking_url` (pendek), `live_tracking_url=null`.
- Implikasi spec: rekonsiliasi bisa menampilkan timeline + alasan cancel + status pembayaran `is_paid`; **field null harus diantisipasi** (sesuai dokumen); field di luar transkripsi wajib diabaikan, bukan error.

## W2 — Uji pemicuan webhook mode mock (write; jalur pemilik + 2 request, opsional)

| Aspek | Isi |
|---|---|
| Tujuan | Membuktikan apakah tenant mock mengirim callback webhook sama sekali, dan menangkap **fixture signed nyata** pertama (menjawab sisa terbuka tiket 05). |
| Prasyarat (tindakan pemilik, bukan API) | 1) Cek dashboard Shipment → Setting → Developer → Webhook: URL yang terdaftar + secret webhook Shipment. 2) Pastikan URL itu publik dan terjangkau (mis. deployment store; bukan localhost). 3) Isi `JUBELIO_SHIPMENT_WEBHOOK_SECRET` di `.env` (key baru; jangan memakai `JUBELIO_WEBHOOK_SECRET` Omnichannel). |
| Alat siap | **Receiver penangkap sudah dibuat dan teruji lokal:** [shipment-webhook-catch.mjs](shipment-webhook-catch.mjs) — zero-dependency, rekam raw body + header `x-jubelio-signature` ke JSONL, verifikasi `HMAC-SHA256(rawBody+secret, key=secret)` timing-safe (sama dengan verifier repo, W0), diagnostik hanya hash prefix 12 kar. Smoke test: event valid ✅ diterima, event tanpa signature ditolak, keduanya terekam. Jalankan: `SHIPMENT_WEBHOOK_SECRET=<secret> PORT=8787 node shipment-webhook-catch.mjs` di host publik. |
| Metode & endpoint | `POST /shipments/create` (data dummy, satu kali) → tunggu ≤ 5 menit → `GET /shipments/awb/{awb}` → `POST /shipments/cancel`. |
| Body tersanitasi | Pola dummy P2 (nilai contoh kontrak, `ref_no=DUMMY-UJI-20260927-02`). |
| Langkah | Receiver sementara (log saja, tidak mutasi DB) menerima callback; simpan **header `x-jubelio-signature` + raw body** sebagai fixture; verifikasi dengan verifier W0. |
| Bukti | Apakah mock mengirim event; fixture signed pertama → algoritma signature Shipment terkonfirmasi atau terkoreksi. |
| Risiko | Sedang-rendah: operasi tulis di mode mock (AWB dibuat lalu dicancel, tanpa kurir live, tagihan tidak berlaku — pemilik: pembayaran di luar kebutuhan app). Bila webhook tidak terdaftar/tidak terkirim, uji tidak menghasilkan bukti webhook (bukan bukti negatif mutlak). |
| Izin | ⏳ menunggu pemilik — **terpisah dari W1**, hanya setelah prasyarat dashboard terpenuhi |

## Yang sengaja TIDAK diusulkan

- Menulis endpoint receiver Shipment ke aplikasi (implementasi — di luar tiket riset; pola desain dicatat di temuan tiket 05).
- Uji `RETURNED`/`SHIPMENT_ISSUE` nyata — tidak bisa dibuat di mode mock tanpa kurir live; tetap jalur vendor/no. 17 draf.
- Retry/polling — bertentangan dengan keputusan pemilik (rekonsiliasi manual tanpa polling).

## Setelah eksekusi

Catat hasil teredaksi ke tiket 05; klasifikasi bukti: dokumen v1.8 → keputusan pemilik → hasil uji lokal (W0) → hasil uji API (W1/W2) → fixture vendor/event nyata.