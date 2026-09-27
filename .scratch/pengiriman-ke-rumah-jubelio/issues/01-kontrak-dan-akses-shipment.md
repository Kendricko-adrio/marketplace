# Kontrak dan akses Shipment pada tenant

Type: research
Label: wayfinder:research
Status: resolved
Blocked by: none
Parent: [Menuju spec pengiriman ke rumah via Jubelio Shipment yang siap ditinjau](../map.md)

## Question

Kontrak API Shipment versi/path mana yang berlaku bagi tenant dan sandbox ini, apakah tenant memiliki akses serta layanan yang dibutuhkan untuk asal cabang yang akan dipilih, dan bukti mana yang masih terbatas pada [transkripsi v1.8](../../../docs/jubelio-api/shipment-v1.8.md)? Bedakan dokumen/vendor tertulis, izin/akses yang dikonfirmasi, dan hasil uji aktual; jangan menyamakan Shipment dengan Omnichannel. Uraikan temuan yang memengaruhi pertanyaan hilir tanpa menyimpulkan integrasi tidak layak hanya dari belum adanya bukti.

Setiap request API memerlukan usulan metode, endpoint, contoh body tersanitasi, langkah dan risiko serta izin pemilik **sebelum request itu**; tiket ini sendiri tidak memberi izin. Subagen riset hanya bila diberi otorisasi terpisah.

## Answer

Ditutup dengan bukti uji live (2026-09-27) **plus keputusan pemilik yang menjawab seluruh 19 pertanyaan vendor langsung** ([detail jawaban](../draf-pertanyaan-ke-jubelio.md)):

1. **Kontrak yang berlaku: v1.8, versi terakhir yang akan dipakai** (keputusan pemilik; 5 path + siklus AWB lengkap terbukti live).
2. **Akses tenant: ada.** Kredensial yang dipakai adalah **kredensial sandbox tenant, dioperasikan melalui URL produksi** `api-shipment.jubelio.com` — konfirmasi pemilik; konsisten dengan AWB prefix `MOCK-` dan penolakan di host sandbox publik. Kurir live belum aktif (mode mock).
3. **Layanan untuk cabang asal:** 19 layanan kurir terbukti respons untuk pasangan wilayah contoh; **asal cabang asli dialihkan ke [tiket 02](02-asal-kirim-dan-data-paket.md)** (butuh data `zipcode`/`area_id` cabang + izin varian U4-asli).
4. **Keputusan desain inti dari pemilik:** `weight` dalam gram di semua level; tanpa kalkulasi volumetrik sendiri (kirim field, vendor menghitung); hitung ongkir dari **`rates`** (live: 19/19 `rates == final_rates`); **tanpa TTL, harga dijamin**; `ref_no` boleh diisi ID order (korelasi terbukti tersimpan); setelah timeout cek via GET AWB; **rekonsiliasi manual di menu admin, tanpa polling**; webhook **mengikuti dokumentasi** (implementasi per contoh kode HMAC-SHA256 di PDF, validasi saat event nyata); terima semua webhook tanpa asumsi urutan; **Sales Order Omnichannel wajib** untuk pesanan website; tagihan kurir di luar cakupan aplikasi.
5. **Bukti tidak lagi terbatas pada transkripsi:** auth, kategori (7, tanpa Bearer), hierarki wilayah (ID string), quote lintas kurir (19 layanan), dan siklus AWB create→detail→cancel semuanya teruji live. Ambiguitas yang diterima pemilik: signature webhook mengikuti contoh dokumen, label ditunda sampai kurir live, `RETURNED`/`SHIPMENT_ISSUE` ditangani manual.

## Comments

- **Riset permukaan API Shipment (dokumentasi lokal, tanpa panggilan API).** Pemilik menegaskan kontrak acuan adalah **v1.8** ([transkripsi](../../../docs/jubelio-api/shipment-v1.8.md)) dan hanya itu permukaan API Jubelio Shipment; tidak ada kontrak Shipment lain yang tertulis di repo. Berkas PDF sumber **tidak ada di working tree** — hanya transkripsinya (diverifikasi ulang). Host `api-shipment.jubelio.com` / `api-shipment.sandbox.jubelio.com`, terpisah dari Omnichannel `api2.jubelio.com`.

  **Permukaan API v1.8 — 12 endpoint outbound + 1 callback masuk:**

  | # | Endpoint | Kegunaan | Catatan kontrak |
  |---|---|---|---|
  | 1 | `POST /auth/generate-token` | Token dari `client_id`+`client_secret` | Contoh `expires_in: 86400`; tipe inkonsisten (tabel string vs contoh angka); token hanya server-side |
  | 2 | `GET /services/categories` | Kategori layanan | Contoh `1 REGULER … 6 CARGO` bukan jaminan layanan tenant |
  | 3 | `GET /regions` (`?name=`) | Pencarian wilayah | Mengembalikan `area_id`+`zipcode`; ID string, jaga nol di depan |
  | 4–7 | `GET /region/provinces`, `/region/cities/{province_id}`, `/region/districts/{city_id}`, `/region/areas/{district_id}` | Hierarki wilayah untuk form alamat | Header auth pada GET tidak eksplisit di PDF — konfirmasi ke vendor |
  | 8 | `POST /rates` | Quote satu kategori (`service_category_id` wajib) | `weight` wajib; unit top-level belum tegas (contoh gram); `items[]`/`package_detail` opsional untuk volumetrik |
  | 9 | `POST /rates/all` | Quote lintas kurir | Tanpa `service_category_id`; **hitung ongkir dari `rates`, bukan `final_rates`**; tanpa quote ID/TTL |
  | 10 | `POST /shipments/create` | Buat AWB | Wajib `ref_no`, `courier_id`, `courier_service_id`, origin/destination `{name, phone, address, zipcode}`, `items[]`; respons `shipment_id`, `awb`, `tracking_url`, `price`; idempotensi `ref_no` tidak dijamin |
  | 11 | `POST /shipments/cancel` | Batalkan AWB | Hanya sebelum pickup dan bisa ditolak kurir; timeout ≠ pasti batal |
  | 12 | `GET /shipments/awb/{awb}` | Detail + tracking | `latest_status` 10 nilai ternormalisasi; `tracking.status` kode kurir berbeda; **tidak ada lookup by `ref_no`** |
  | — | Webhook status (callback masuk) | Diatur di dashboard Shipment, bukan endpoint yang kita panggil | `x-jubelio-signature`: prosa SHA-256 vs contoh kode HMAC-SHA256 bertentangan — wajib fixture signed vendor |

  **Yang tidak tersedia di v1.8:** endpoint label; daftar/lookup shipment tanpa AWB; quote ID/TTL; idempotensi booking; rate limit/retry; daftar event webhook; kaitan Sales Order Omnichannel/stok. Path plugin (`/webstore/rates/all`, `GET /shipments/{shipment_id}`, `POST /shipments/generate-shipping-label`) **bukan** bagian kontrak ini.

  **Klasifikasi bukti (sesuai tuntutan tiket):**
  - *Dokumen/vendor tertulis:* hanya transkripsi v1.8 (PDF absen dari working tree); README menegaskan Shipment ≠ Omnichannel.
  - *Izin/akses terkonfirmasi:* **tidak ada.** `.env` hanya memuat kredensial Omnichannel (`JUBELIO_API_BASE_URL` → `api2.jubelio.com`, login email/password); tidak ada `client_id`/`client_secret` Shipment, kredensial sandbox, atau konfirmasi dashboard; `.env.example` juga tidak menyiapkan variabel Shipment.
  - *Hasil uji aktual:* **tidak ada** — tidak ada panggilan API dalam riset ini; setiap request menunggu izin pemilik per request.

  **Sisa pertanyaan tiket:** versi kontrak yang berlaku *secara live* di tenant/sandbox, aktivasi tenant, kredensial sandbox, dan layanan per cabang asal hanya dapat dibuktikan lewat konfirmasi vendor atau request sandbox berizin per-request, atau keputusan pemilik menerima ketidakpastian pada spec. Tidak ada bukti akses ≠ integrasi tidak layak.

  **Dampak hilir:** [02](02-asal-kirim-dan-data-paket.md) butuh `area_id`/`zipcode` cabang asal dari endpoint wilayah Shipment; [05](05-webhook-dan-bukti-status.md) terkunci ambiguitas signature webhook; [06](06-kontrak-quote-hingga-pembayaran.md) terkait aturan `rates` vs `final_rates` dan ketiadaan TTL quote.

- **Keputusan pemilik (sesi ini, melalui tanya-jawab terstruktur):**
  - Kontrak acuan desain = **v1.8** (pernyataan pemilik di awal sesi: "hanya itu saja api yang ada pada jubelio shipment").
  - **Kredensial sandbox Shipment dilaporkan sudah ada di luar repo** (pernyataan pemilik; belum diverifikasi berfungsi — naikkan ke "terkonfirmasi" hanya setelah U1 lulus).
  - Pemilik menetapkan **keempat kelompok ketidakpastian harus terjawab dulu** sebelum desain dilanjutkan: akses & layanan kurir; harga & tagihan; webhook & keamanan; label pengiriman. Ketidakpastian **belum** diterima sebagai keputusan.
  - Pemilik menyetujui penyusunan (bukan eksekusi): [usulan uji sandbox per-request](../usulan-uji-sandbox.md) (U1–U4, read-only, sandbox saja) dan [draf pertanyaan vendor](../draf-pertanyaan-ke-jubelio.md) yang dikirim sendiri oleh pemilik. Eksekusi tiap request tetap butuh izin per request.

- **Hasil uji aktual pertama (2026-09-27, sandbox, read-only; izin per-request diberikan pemilik untuk U1–U4):**
  - **U1** `POST /auth/generate-token` → **HTTP 400** `{"code":"ERR_INPUT","message":"Akun tidak ditemukan"}`. Kredensial yang diisi pemilik (masing-masing 22 karakter, tanpa spasi, tidak identik dengan key lain di `.env`) **ditolak — akun tidak dikenal**. Kemungkinan: pasangan kredensial bukan milik Shipment sandbox, atau akun sandbox belum dibuat/diaktifkan. Kredensial Shipment valid **belum terbukti**.
  - **U2b** `GET /services/categories` **tanpa Bearer** → **HTTP 200**. Temuan: (a) endpoint ini **tidak memerlukan auth** — menjawab keraguan kontrak bahwa GET wilayah/kategori mungkin butuh Bearer; (b) daftar live = **7 kategori**: `1 REGULER, 2 EKONOMI, 3 NEXTDAY, 4 INSTANT, 5 SAMEDAY, 6 CARGO, 7 MUATAN TRUK PENUH` — berbeda dari contoh PDF (6 kategori). **Drift dokumen vs live terbukti untuk daftar kategori**; contoh transkripsi memang bukan daftar final.
  - **U2a/U3/U4 dilewati** — butuh token valid; menunggu kredensial yang diterima API.
  - Dampak klasifikasi bukti: sandbox host terjangkau dan merespons; kategori publik; kredensial pemilik **belum valid** — status "izin/akses terkonfirmasi" masih belum tercapai, tapi kini ada hasil uji aktual (bukan hanya dokumen).

- **Hasil uji aktual ke host PRODUKSI `api-shipment.jubelio.com` (2026-09-27; pemilik mengganti izin host dari sandbox ke produksi via tanya-jawab terstruktur; semua read-only, tanpa booking; token hanya di memori):**
  - **U1** `POST /auth/generate-token` → **HTTP 200**: token diterima (205 karakter, tidak disimpan/log), `expires_in: 86400` bertipe **angka** — ambiguitas tipe di kontrak terjawab.
  - **U2a/U2b** `GET /services/categories` → 200 dengan dan **tanpa** Bearer: GET kategori tidak butuh auth; **7 kategori** sama seperti sandbox.
  - **U3a/U3b** `GET /region/provinces` → 200 (**34 provinsi**, `province_id` string), `GET /region/cities/11` → 200 (23 kota, `city_id` string).
  - **U4** `POST /rates/all` (nilai contoh kontrak) → 200: **19 layanan kurir** — Lion Parcel JAGOPACK/REGPACK, SiCepat REG/BEST, ID Express Standard, TIKI Reguler, JNE REG, J&T EZ/Next Day, Paxel Nextday/Sameday, Anteraja Regular, dst.; semua sampel `rates == final_rates`; `is_cod_supported` false; `eta_from/to` **timestamp ISO absolut**; `shipping_insurance` nominal 100–5100 (semantik premi vs pertanggungan masih perlu konfirmasi vendor).
  - **Kesimpulan akses:** tenant **punya akses Jubelio Shipment di produksi**; kredensial tersedia ber-scope produksi; **sandbox tidak tersedia untuk kredensial ini** (akun tidak ada di sandbox) — uji lanjutan berbasis sandbox butuh kredensial sandbox terpisah dari vendor (draf pertanyaan no. 1–3). Path v1.8 yang teruji live: `/auth/generate-token`, `/services/categories`, `/region/provinces`, `/region/cities/{province_id}`, `/rates/all`.
  - **Masih terbatas pada transkripsi/dokumen:** `/regions` (search), `/region/districts|areas`, `POST /rates` (satu kategori), seluruh siklus AWB (`/shipments/create|cancel`, `GET /shipments/awb/{awb}`), webhook (signature/events), label, semantik harga (`weight` unit, volumetrik, TTL quote), charge timing. Layanan untuk **cabang asal asli** menunggu data cabang (tiket 02) + izin varian U4 asli.

- **Keputusan pemilik atas 19 pertanyaan vendor (2026-09-27, tanya-jawab langsung):** seluruh draf dijawab pemilik — v1.8 final; kredensial = **sandbox tenant via URL produksi** (mode mock); `weight` gram; tanpa TTL & harga dijamin; `ref_no` boleh diisi ID order; cek timeout via GET AWB; rekonsiliasi **manual di admin tanpa polling**; webhook ikut dokumentasi (contoh HMAC-SHA256); terima semua event tanpa asumsi urutan; **Sales Order wajib**; label ditunda; tagihan kurir di luar cakupan app. Lengkap: [draf-pertanyaan-ke-jubelio.md §Jawaban pemilik](../draf-pertanyaan-ke-jubelio.md).

- **Uji siklus AWB lengkap P1–P5 (produksi, 2026-09-27; izin pemilik via tanya-jawab; data dummy penuh, satu percobaan, tanpa retry):**
  - **P1** `POST /rates/all` → 19 layanan; termurah Lion Parcel JAGOPACK: `courier_id=24`, `courier_service_id=2453`, `rates=7500` (ID numerik, cocok kontrak).
  - **P2** `POST /shipments/create` → **HTTP 201**: `shipment_id=1`, `awb=MOCK-JS2420810000000001`, `price=7500` (= `rates` quote), `tracking_url` + `short_tracking_url`, `courier_id` echo. **Temuan penting:** prefix AWB `MOCK-` dan `shipment_id=1` mengindikasikan tenant masih dalam **mode mock** (kurir belum live) — pertanyaan baru ditambahkan ke draf vendor.
  - **P3** `GET /shipments/awb/MOCK-JS2420810000000001` → 200: `latest_status=WAITING`, `ref_no` tersimpan utuh (`DUMMY-UJI-20260927-01`) — korelasi order kita terbukti bisa disimpan, `price=7500`, `price_bill=7500`, 1 entri tracking, nama kurir ada.
  - **P4** `POST /shipments/cancel` → 200: `{"status":"Cancel Successful","awb_code":…,"courier_name":"Lion Parcel","ref_no":…}`.
  - **P5** GET ulang → `latest_status=CANCELED`, tracking 2 entri, entri terakhir `status: "CANCELED"` + `status_detail` = alasan cancel. **Catatan kosakata:** AWB detail memakai status ternormalisasi (`CANCELED`), berbeda dari contoh webhook PDF (`CNCL`) — dua kosakata, konsisten dengan peringatan transkripsi.
  - **Implikasi:** alur quote→create→detail→cancel→status berfungsi end-to-end; `price` booking == `rates` quote pada sampel ini; `ref_no` bisa diisi ID order kita untuk korelasi. Sisa bukti yang dibutuhkan: perilaku charge sesungguhnya (mode live), idempotensi, dan webhook — tetap di jalur vendor/desain.
