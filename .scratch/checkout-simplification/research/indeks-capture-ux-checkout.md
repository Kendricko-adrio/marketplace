# Indeks capture audit UI/UX checkout dan pembayaran

Dokumen ini adalah indeks tahan lama untuk kumpulan screenshot audit yang dihasilkan dari
[spec audit](../plan/spec-audit-ux-checkout-pembayaran.md). Semua gambar adalah **UI asli store
dengan data bisnis simulasi**. Screenshot, galeri, script, dan manifest bersifat **disposable**
(gitignored) di `playwright/mcp/checkout-ux-review/`; dokumen ini mencatat ID, state, fixture,
cakupan, dan keterbatasannya.

- Status capture: **39 skenario runner berstatus Captured, 0 Pending, 180 PNG**.
- Galeri lokal: [gallery.html](../../../playwright/mcp/checkout-ux-review/gallery.html)
  (label “DATA SIMULASI” hanya di galeri, bukan overlay UI).
- Metadata machine-readable: [manifest.json](../../../playwright/mcp/checkout-ux-review/manifest.json)
  dan [report.json](../../../playwright/mcp/checkout-ux-review/report.json).
- Catatan review & checklist: [review-ux-checkout-pembayaran.md](review-ux-checkout-pembayaran.md).

## Cara membuka dan memeriksa

1. Buka `playwright/mcp/checkout-ux-review/gallery.html` langsung dari filesystem (tanpa server).
   Galeri tidak memuat resource eksternal dan setiap kartu menautkan PNG ukuran penuh.
2. Gunakan `manifest.json` untuk memfilter per `scenarioId`, viewport, atau `captureType`.
   Setiap entri memuat `id`, `scenarioId`, `viewport`, `captureType`, `path`, `route`,
   `fixtureId`, `dataMode: simulated`, `capturedAt`, `observation`, `limitations`.
3. Untuk pemeriksaan keyboard/contrast/target/reflow, baca `report.json` bagian `probes`
   (kunci `keyboard-*`, `contrast-*`, `targets-*`, `reflow-*`, `text200-*`, `dialog-*`,
   `continuity-*`, `address-draft-*`).

## Lingkungan dan akses

| Hal | Nilai |
|---|---|
| Origin | `http://localhost:3000` (store lokal) |
| Browser | Chromium `151.0.7922.34` headless, light theme, locale `id-ID`, timezone `Asia/Jakarta` |
| Runtime | Node `v24.14.0`, Playwright lokal `1.62.1` |
| Viewport | Desktop 1440×900 (tanpa `isMobile`), mobile 390×844 (`isMobile` + `hasTouch`) |
| Pemeriksaan tambahan | 320 CSS px dan root font-size 200% (emulasi teks), bukan seluruh kombinasi |
| Login | Akun demo seeded via form UI, HTTP 200; session store nyata, `emailVerified` & `onboardingCompleted` true |
| Tanggal fixture | Pickup Selasa `2026-11-17` 10:00; hari tutup Minggu `2026-11-22` |
| Command | `node playwright/mcp/checkout-ux-review/capture.cjs` lalu `node playwright/mcp/checkout-ux-review/gallery.cjs` |
| Hasil terakhir | exit 0, 39/39 skenario Captured, 180 PNG, 0 `pageerror` |

### Boundary request yang dipakai

- Hanya `GET /api/auth/get-session`, `GET /api/onboarding/sync`, dan satu
  `POST /api/auth/sign-in/email` saat bootstrap login yang diteruskan nyata.
- Cart, cabang, alamat, region, quote ongkir, promo, preview, validate-step-2,
  place-order, request lookup, dan order detail **dimock** per skenario.
- API lain fail-closed (409); mutasi non-API dan seluruh request keluar origin di-**abort**.
- Submit pembayaran tidak pernah dijalankan; respons `place-order` adalah fixture.
- Tidak ada cookie/credential/PII yang dicetak atau ditulis ke disk. Storage state login
  hanya berada di memori proses script.

Contoh request yang tercatat pada run terakhir (teredaksi, tanpa query/token):
`POST /api/checkout/preview → mocked-business` (38×),
`POST /api/discounts/available → mocked-business` (56×),
`POST /api/checkout/place-order → mocked-business` (6×),
satu `GET /audit/JNE-AUD-… → blocked-external` dari uji link tracking.
Rincian lengkap ada di `report.json` bagian `network`.

## Matriks capture F01–O10

Notasi path: `screenshots/<ID>.png`. Semua baris memiliki capture desktop **dan** mobile.
`viewport, full-page` berarti layar utama memiliki keduanya; modal/transien memakai viewport.

| ID | Surface / state | Fixture | Capture (ID) | Status | Catatan cakupan |
|---|---|---|---|---|---|
| F01 | Checkout awal | cart-baseline / branch-open / pickup | `F01-{desktop,mobile}-{viewport,full}` | Captured | CTA `Lanjut` sudah aktif sebelum input; email terisi dari sesi demo. |
| F02 | Pickup siap | pickup Selasa 10:00 / kontak valid | `F02-…-{viewport,full}` | Captured | Ringkasan “Pengambilan: …”, disclaimer amber, CTA. |
| F03 | Pickup invalid | cabang tutup; kontak invalid; slot ditolak server | `F03-…-{closed,contact,slot}-viewport` | Captured | Tiga substate terpisah; pesan slot server berbahasa Inggris. |
| F04 | Delivery awal | alamat ada tanpa default | `F04-…-{viewport,full}` | Captured | Placeholder alamat, kontak read-only kosong, CTA disabled. |
| F05 | Alamat existing | alamat default + dropdown | `F05-…-dropdown-viewport`, `F05-…-selected-full` | Captured | Opsi alamat tidak siap wilayah tampil disabled. |
| F06 | Alamat baru | modal kosong; draft lengkap; region gagal | `F06-…-{empty,draft,region-error}-viewport` | Captured | Kode pos terisi otomatis; draft dibuang saat modal ditutup (lihat X05). |
| F07 | Buku alamat kosong/gagal | 500 lalu `[]` | `F07-…-{error,empty}-viewport` | Captured | Error + retry; empty state. |
| F08 | Quote ongkir | loading; 503; services kosong; retry sukses | `F08-…-{loading,error,empty,recovered}-viewport` | Captured | Tidak ada harga stale; retry mengembalikan daftar. |
| F09 | Layanan siap | 8 layanan, 2 halaman, 6 kategori | `F09-…-{page1,selected,page2,category}-viewport` | Captured | Pilihan lintas halaman bertahan; CTA aktif setelah pilih. |
| F10 | Ganti tujuan/metode | alamat B; pickup | `F10-…-{address-changed,method-switch}-viewport` | Captured | Pilihan layanan hilang saat alamat berganti (terukur), quote diulang; switch ke pickup membuang state delivery. |
| P01 | Review pickup | 166.500 tanpa promo | `P01-…-{viewport,full}` | Captured | 8 blok sebelum CTA; total terverifikasi. |
| P02 | Review delivery | JNE REG 12.000 → 179.820 | `P02-…-{viewport,full}` | Captured | Ongkir 12.000, PPN 17.820, total 179.820; ETA tidak diulang di review. |
| P03 | Konfirmasi | belum/sudah dicentang | `P03-…-{unchecked,checked}-viewport` | Captured | CTA disabled→enabled; teks persetujuan panjang. |
| P04 | Picker promo | 12 promo, 2 halaman, ineligible, kode invalid | `P04-…-{page1,page2,code-invalid}-viewport` | Captured | Tidak ada search/sort di UI; pagination bekerja. |
| P05 | State promo | terpasang; invalid; kosong; gagal | `P05-…-{applied,applied-breakdown,invalid,empty,error}-viewport` | Captured | Total terpasang 144.300; error/retry; input kode tetap. |
| P06 | Ganti/lepas promo | naik 144.300→160.950; batal; turun 138.750 | `P06-…-{increase,increase-cancelled,increase-confirmed,decrease,decrease-breakdown}-viewport` | Captured | Dialog naik, batal mempertahankan total lama, konfirmasi mengganti; penurunan tanpa dialog. |
| P07 | Promo gugur | kuota habis setelah review | `P07-…-{viewport,full,alert}-…` | Captured | Alert + alasan; total kembali tanpa diskon; CTA tertutup. |
| P08 | Preview/submit | loading; pajak; submit loading; rejected | `P08-…-{preview-loading,submit-loading,submit-rejected,submit-rejected-inline,tax-unavailable}-viewport` | Captured | Toast + feedback inline; fokus ke alert pajak. |
| P09 | Recovery checkout | request tersimpan; status processing | `P09-…-{recovery-card,recovery-checked}-viewport` | Captured | Layar recovery tunggal; tidak ada jalan ke detail saat processing. |
| P09b | Attempt processing | submit → processing | `P09b-…-{attempt-processing,attempt-processing-inline}-viewport` | Captured | Membuktikan feedback inline dan toast; bukan order nyata. |
| P10 | Stock/harga berubah | qty 2→1, total 111.000 | `P10-…-{viewport,full}` | Captured | Banner stok + banner review ulang; total fallback baru. |
| R01 | Hasil pending | query `pending` | `R01-…-viewport` | Captured | CTA detail; tanpa CTA bayar ulang/kedaluwarsa. |
| R02 | Hasil sukses | query `settlement` | `R02-…-viewport` | Captured | Copy menyebut kode pickup untuk semua metode; ID dipotong 8 karakter. |
| R03 | Hasil gagal/batal | query `deny` | `R03-…-viewport` | Captured | Copy “pesanan telah dibatalkan” dari query, bukan status order. |
| O01 | Detail pending delivery | 199.800 + snap lokal | `O01-…-{viewport,full}` | Captured | Tracking “resi belum tersedia” muncul sebelum alamat/barang; CTA bayar jauh di kanan/bawah. |
| O02 | Detail pending pickup | cabang+slot, tanpa kode | `O02-…-{viewport,full}` | Captured | Kode pickup tidak tampil sebelum siap; CTA bayar setelah barang. |
| O03 | Paid delivery | processing; paid+blocked | `O03-…-{paid,blocked}-viewport` | Captured | Status order vs pembayaran vs pemenuhan terpisah. |
| O04 | Tracking | dalam perjalanan; 6 event; delivered | `O04-…-{ontheway,expanded,delivered}-viewport` | Captured | Timeline ringkas/terbuka, POD; tanpa ETA di panel. |
| O05 | Paid pickup | belum siap; ready+kode; completed | `O05-…-{notready,ready,copy-success,completed}-viewport` | Captured | Kode tetap tampil saat completed; salin kode sukses. |
| O06 | Recovery pembayaran | session belum tersedia | `O06-…-{viewport,checked}-viewport` | Captured | Tombol periksa status tidak memberi feedback perubahan. |
| O07 | Gagal/batal | failed_payment; cancelled | `O07-…-{failed,cancelled}-viewport` | Captured | Alasan gagal; tidak ada CTA langsung ke katalog. |
| O08 | Loading/error | skeleton; 500+retry; 404 | `O08-…-{loading,error,retry,notfound}-viewport` | Captured | Retry berhasil; empty state jelas. |
| O09 | Parsial/panjang | 8 barang, tanpa resi, status asing | `O09-…-{viewport,full}` | Captured | Tinggi 1778/3486 px; status asing netral. |
| O10 | Feedback action | clipboard ditolak; resi sukses; link eksternal | `O10-…-{clipboard,copy-resi-success,external}-viewport` | Captured | Feedback jujur; link eksternal diblokir boundary audit. |

### State yang tidak berlaku (N/A) atau tidak diklaim

| Hal | Status | Alasan |
|---|---|---|
| UI Midtrans, pembuatan token/session, pembayaran nyata, webhook | N/A | Di luar scope spec; tidak ada transaksi provider. |
| Search/sort promo | N/A | UI existing tidak menyediakan search/sort; hanya kode manual + pagination. Tidak diklaim ada backend search. |
| Audit katalog, cart, login/onboarding, admin, email | N/A | Surface di luar scope; cart hanya dipakai sebagai boundary saat kosong/selection hilang. |
| Dark theme, browser selain Chromium, zoom selain 200% | N/A | Baseline audit adalah Chromium light theme; kombinasi lain tidak dijanjikan. |
| Sertifikasi WCAG / audit legal / PCI | N/A | Pemeriksaan terarah, bukan klaim kepatuhan menyeluruh. |
| Bukti integrasi provider (Midtrans/Jubelio) | N/A | Request bisnis dimock; screenshot tidak membuktikan integrasi nyata. |
| URL state/search/sorting baru | N/A | Perilaku existing diperiksa; tidak ada fitur baru diuji/diklaim. |
| Transaksi nyata & order nyata | N/A | Dilarang oleh boundary; semua order/attempt adalah fixture. |

## Pemeriksaan terarah (probe) dan evidence

Probe dijalankan pada halaman yang sama setelah capture utama; nilainya ada di `report.json`
dan diringkas di dokumen review. Screenshot X01/X03 hanya bukti reflow 320 px.

| Probe | Cakupan | Kunci di `report.json` |
|---|---|---|
| Urutan tab & fokus | Review checkout, detail order (desktop/mobile) | `keyboard-checkout-review-*`, `keyboard-order-detail-*` |
| Select/checkbox keyboard | Pickup time select 10:00→10:30; checkbox persetujuan | `keyboard-select-*`, `keyboard-checkbox-*` |
| Dialog keyboard | Picker promo: fokus masuk, Space/Arrow, Escape, focus return; modal alamat focus return | `dialog-promo-picker-*`, `dialog-address-focus` |
| Target pointer | Button/link/input/radio/checkbox di checkout, promo, alamat, detail, result | `targets-*` |
| Contrast teks | Computed color vs background efektif (light) | `contrast-*` |
| Reflow 320 | Review checkout, detail order | `reflow-*-320-*` + PNG `X01-320-*`, `X03-320-*` |
| Teks 200% | Review checkout, detail order (emulasi root font-size) | `text200-*` |
| Kontinuitas | Back, refresh, draft alamat, session selection | `continuity-*`, `address-draft-*` |

### Catatan eksekusi dan deviasi

- Tanggal pickup dihitung dinamis (Selasa berikutnya) agar tidak kedaluwarsa; nilai yang
  tertangkap pada run terakhir adalah `2026-11-17` dan hari tutup `2026-11-22`.
- Email pada F02/P01/P02 dapat berasal dari akun demo seeded; untuk fixture checkout,
  field email diisi nilai sintetik `audit.pemesan@example.test`. Setelah refresh (X05),
  prefill sesi mengembalikan email demo `john@example.com` dan telepon demo.
- Full-page screenshot dengan header sticky dapat menampilkan header di tengah gambar
  (artefak komposisi Chromium full-page). Viewport screenshot adalah acuan area tersebut.
- Indikator development Next.js (`nextjs-portal`) dapat muncul di screenshot dan urutan tab;
  itu bukan UI produk dan tidak dijadikan temuan produk.
- 200% teks diemulasikan dengan `documentElement.style.fontSize = "200%"` (bukan browser
  text zoom). Ini pengukuran terarah; lihat keterbatasan di dokumen review.
- Clipboard sukses diuji dengan izin `clipboard-write`; clipboard ditolak diuji dengan
  override `navigator.clipboard` pada halaman. Keduanya perilaku browser, bukan server.
- Link tracking eksternal sengaja diblokir boundary; perilaku produksi tidak diklaim.

### Preflight yang masih relevan

Preflight sebelum audit membuktikan login seed, render checkout protected, detail order,
hasil pending, dan capture dasar. Laporan dan caveat-nya tetap berlaku:
[preflight-playwright-dan-akses-store.md](preflight-playwright-dan-akses-store.md).
Audit ini memperluas bukti ke seluruh matriks F01–O10 dan probe, tetapi tidak mengubah
temuan preflight (MCP Chrome tidak tersedia, warning logo, badge development).

## Traceability artefak

| Artefak | Lokasi |
|---|---|
| Script capture | `playwright/mcp/checkout-ux-review/capture.cjs` |
| Fixture sintetik | `playwright/mcp/checkout-ux-review/fixtures.cjs` |
| Manifest | `playwright/mcp/checkout-ux-review/manifest.json` |
| Report + probe | `playwright/mcp/checkout-ux-review/report.json`, `report.md` |
| Galeri | `playwright/mcp/checkout-ux-review/gallery.html` |
| Screenshot | `playwright/mcp/checkout-ux-review/screenshots/` (gitignored) |
| Pemeriksaan galeri | `check-gallery.cjs` (180/180 gambar termuat, 0 resource eksternal, 0 error) |

Verifikasi galeri terakhir: 180 kartu gambar, seluruh file manifest ada, tidak ada href
yang hilang, tidak ada request eksternal, dan tidak ada page error. Angka ini adalah hasil
run terakhir, bukan jaminan artefak disposable tetap ada di checkout lain.
