# Usulan uji sandbox Jubelio Shipment (belum dieksekusi)

Status: **usulan**. Tidak ada request yang dijalankan sebelum pemilik memberi izin untuk **request tersebut**. Eksekusi hanya ke **sandbox** (`https://api-shipment.sandbox.jubelio.com`), bukan produksi. Rujukan kontrak: [`docs/jubelio-api/shipment-v1.8.md`](../../docs/jubelio-api/shipment-v1.8.md).

## Persiapan (dilakukan pemilik, bukan lewat chat)

- Key `JUBELIO_SHIPMENT_CLIENT_ID` dan `JUBELIO_SHIPMENT_CLIENT_SECRET` **sudah ditambahkan kosong** ke `.env` (file ter-ignore git — diverifikasi `.gitignore` baris 41) dan terdokumentasi di `.env.example`. Pemilik **mengisi nilainya sendiri** dari sumber kredensial sandbox; jangan dikirim lewat chat dan jangan di-commit.
- Kredensial hanya dibaca dari env saat eksekusi; token tidak disimpan di file/log; output yang dicatat ke tiket **diredaksi** (tanpa token, tanpa secret).
- Jika suatu saat kredensial produksi tersedia: **tidak dipakai** pada usulan ini. Eksekusi tetap menunggu persetujuan pemilik **per request**.

## U1 — Buktikan kredensial sandbox berfungsi

| Aspek | Isi |
|---|---|
| Tujuan | Membuktikan akun/kredensial Shipment aktif dan mengukur `expires_in` aktual. |
| Metode & endpoint | `POST /auth/generate-token` |
| Body tersanitasi | `{"client_id": "<JUBELIO_SHIPMENT_CLIENT_ID>", "client_secret": "<JUBELIO_SHIPMENT_CLIENT_SECRET>"}` |
| Langkah | 1) Pemilik set env. 2) Satu `curl` ke sandbox host. 3) Catat status HTTP dan `expires_in` (token tidak dicatat). |
| Bukti yang dihasilkan | Akses tenant terkonfirmasi (atau pesan error yang menunjukkan kredensial salah/belum diaktifkan). |
| Risiko | Rendah. Endpoint auth saja, sandbox, tanpa efek samping. Kegagalan tidak mengubah apa pun. |
| Izin | ✅ diizinkan; dijalankan 2026-09-27 — sandbox **gagal** (HTTP 400 `ERR_INPUT "Akun tidak ditemukan"`) → produksi **sukses** HTTP 200 (token 205 kar, `expires_in: 86400` angka) |

## U2 — Daftar kategori layanan (termasuk uji apakah GET butuh token)

| Aspek | Isi |
|---|---|
| Tujuan | Mengetahui kategori layanan yang benar-benar tersedia; sekaligus menguji kontrak yang tidak eksplisit soal auth pada GET (satu panggilan **dengan** Bearer, satu **tanpa**). |
| Metode & endpoint | `GET /services/categories` (2× : dengan dan tanpa header `Authorization`) |
| Body | Tidak ada. |
| Langkah | Pakai token U1. Catat status kedua panggilan (200/401) dan isi respons. |
| Bukti | Daftar `service_category_id` + nama aktual; jawaban atas "apakah GET butuh Bearer". |
| Risiko | Rendah. Read-only. |
| Izin | ✅ diizinkan; dijalankan 2026-09-27 — tanpa Bearer sukses 200 (7 kategori, sandbox & produksi); dengan Bearer sukses 200 (produksi) |

## U3 — Hierarki wilayah berfungsi

| Aspek | Isi |
|---|---|
| Tujuan | Membuktikan lookup wilayah untuk form alamat & pemetaan `area_id`/`zipcode`. |
| Metode & endpoint | `GET /region/provinces`, lalu satu turunan: `GET /region/cities/{province_id}` untuk satu provinsi contoh. |
| Body | Tidak ada. |
| Langkah | Dengan Bearer dari U1; catat bentuk respons (ID string? kode pos?). |
| Bukti | Hierarki provinsi→kota berfungsi di sandbox; format ID/`zipcode` aktual. |
| Risiko | Rendah. Read-only. |
| Izin | ✅ diizinkan; dijalankan 2026-09-27 di produksi — provinces 200 (34 provinsi, ID string); cities/11 200 (23 kota, ID string) |

## U4 — Daftar kurir/ongkir untuk pasangan wilayah contoh kontrak

| Aspek | Isi |
|---|---|
| Tujuan | Membuktikan endpoint tarif berjalan dan **kurir/layanan apa yang tersedia** (inti pertanyaan "layanan yang dibutuhkan untuk asal cabang"). |
| Metode & endpoint | `POST /rates/all` |
| Body tersanitasi | Nilai contoh dari kontrak (bukan data cabang asli): `{"origin":{"area_id":"3174021004","zipcode":"12920"},"destination":{"area_id":"3175101006","zipcode":"17425"},"package_detail":{"width":20,"height":5,"length":30},"weight":1000,"total_value":40000}` |
| Langkah | Dengan Bearer; catat daftar kurir/layanan, `rates`, `eta_from/to`, `is_cod_supported`. **Tidak melakukan booking.** |
| Bukti | Kurir & layanan yang merespons di sandbox untuk pasangan wilayah contoh; membandingkan `rates` vs `final_rates` aktual. |
| Risiko | Rendah. Read-only, tidak membuat resi. Varian lanjutan dengan `zipcode`/`area_id` cabang asal **asli** menunggu data cabang (tiket 02) dan izin terpisah. |
| Izin | ✅ diizinkan; dijalankan 2026-09-27 di produksi — **19 layanan kurir** (rates == final_rates di semua sampel, cod false, eta timestamp absolut); varian cabang asal asli tertunda data tiket 02 |

## Hasil eksekusi (2026-09-27)

- **U1 gagal** — HTTP 400 `{"code":"ERR_INPUT","message":"Akun tidak ditemukan"}`. Kredensial terisi (22 karakter masing-masing, bukan salinan key lain di `.env`) ditolak: akun tidak dikenal sandbox. Perlu verifikasi ulang sumber kredensial atau konfirmasi vendor (draf pertanyaan no. 1–3).
- **U2b sukses** — `GET /services/categories` tanpa Bearer → HTTP 200. Dua temuan: GET kategori **tidak butuh auth**; daftar live **7 kategori** (`1 REGULER, 2 EKONOMI, 3 NEXTDAY, 4 INSTANT, 5 SAMEDAY, 6 CARGO, 7 MUATAN TRUK PENUH`) — contoh PDF hanya 6; **drift dokumen vs live terbukti**.
- **Lanjutan ke produksi (izin pemilik mengganti host, 2026-09-27):** U1–U4 dijalankan ulang ke `api-shipment.jubelio.com` — **semua sukses**; detail dan implikasi dicatat di tiket 01. Kredensial terbukti ber-scope produksi; sandbox tidak memiliki akun tenant ini. Varian U4 dengan cabang asal asli menunggu data cabang (tiket 02) dan izin terpisah.
- Fasa sandbox: U2a/U3/U4 tertunda menunggu kredensial sandbox. Tidak ada token/secret yang dicetak ke log mana pun.

## Uji write: booking dummy P1–P5 (2026-09-27, produksi; izin pemilik via tanya-jawab)

| # | Request | Hasil |
|---|---|---|
| P1 | `POST /rates/all` (read-only) | 19 layanan; termurah Lion Parcel JAGOPACK `courier_id=24`, `courier_service_id=2453`, `rates=7500` |
| P2 | `POST /shipments/create` (data dummy) | **HTTP 201** — `shipment_id=1`, `awb=MOCK-JS2420810000000001`, `price=7500` (= `rates`), `tracking_url`, `short_tracking_url` |
| P3 | `GET /shipments/awb/{awb}` | 200 — `latest_status=WAITING`, `ref_no` tersimpan utuh, `price`=`price_bill`=7500 |
| P4 | `POST /shipments/cancel` | 200 — `{"status":"Cancel Successful", …}` |
| P5 | `GET /shipments/awb/{awb}` ulang | 200 — `latest_status=CANCELED`, tracking 2 entri, `tracking[].status="CANCELED"` |

Temuan kunci: siklus quote→create→detail→cancel→status **berfungsi end-to-end**; `ref_no` korelasi tersimpan; `price` booking == quote `rates` pada sampel. **Perhatian:** prefix AWB `MOCK-` + `shipment_id=1` → tenant masih dalam **mode mock** (kurir belum live); pertanyaan baru no. 19 di draf vendor. Tidak ada retry; token hanya di memori.

## Yang sengaja TIDAK diusulkan sekarang

- `POST /shipments/create` dan `POST /shipments/cancel` — operasi tulis (membuat/membatalkan AWB); diusulkan terpisah hanya setelah U1–U4 lulus dan pemilik menyetujui skenario booking sandbox.
- Setup webhook dan host produksi.
- Semua host produksi.

## Setelah eksekusi

Catat hasil (teredaksi) ke tiket 01 sebagai bukti **uji aktual**; kerangka klasifikasi bukti di tiket tetap: dokumen/vendor tertulis → izin/akses terkonfirmasi → hasil uji aktual.