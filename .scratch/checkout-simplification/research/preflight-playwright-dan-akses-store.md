# Preflight Playwright dan akses store

## Scope dan hasil ringkas

User meminta pemanasan tooling sebelum audit: pastikan Playwright/browser, screenshot, env lokal dan login akun seed dapat digunakan. Pemeriksaan ini **bukan pelaksanaan audit lengkap** pada [draft spec](../plan/spec-audit-ux-checkout-pembayaran.md), bukan approval spec, dan tidak mengubah UI aplikasi.

Jalur alternatif **Playwright lokal + Chromium headless berhasil**. Login akun demo melalui UI menghasilkan HTTP 200, session store valid, email verified dan onboarding lengkap. Checkout, detail pesanan demo dan hasil pembayaran pending berhasil dirender. Delapan screenshot PNG dibuat. Browser MCP tetap terblokir karena Chrome yang dicari tidak tersedia.

## Lingkungan yang diperiksa

- Origin `http://localhost:3000` aktif, HTTP 200.
- Node `v24.14.0`, Playwright `1.62.1`, Chromium `151.0.7922.34` tersedia dan dapat diluncurkan.
- `.env` dan `apps/store/.env.local` tersedia. Pemeriksaan hanya mengeluarkan boolean presence/origin, bukan nilai secret.
- `DATABASE_URL` dan `BETTER_AUTH_SECRET` terisi; konfigurasi `BETTER_AUTH_URL` dan `NEXT_PUBLIC_APP_URL` sesuai origin lokal.
- Keberhasilan login/session membuktikan jalur auth/database berfungsi untuk akun tersebut, bukan seluruh query bisnis atau integrasi eksternal.
- Source konfigurasi: `apps/store/next.config.ts` memuat root env lalu override app-local env. Pemeriksaan file tidak membuktikan seluruh env proses server identik, tetapi request login/redirect lokal terverifikasi.
- Konfigurasi/konektivitas Midtrans, Jubelio, SMTP dan OAuth tidak divalidasi karena tidak diperlukan untuk audit demo. Field diagnostik `jubelioKeyPresent` hanya memeriksa nama `JUBELIO_API_KEY`; **bukan indikator kelengkapan konfigurasi Jubelio**, yang memakai nama env lain pada source.

## Bukti dan command

Command utama terakhir:

```bash
node playwright/mcp/preflight-checkout-ux/probe.cjs
```

Hasil terakhir: exit 0, 9 pemeriksaan Verified, 8 PNG, login HTTP 200, payload login cocok dengan akun demo tanpa mencetak nilainya, `pageErrors: []`.

Command diagnostik tambahan:

```bash
AUTH_DIAGNOSTIC=1 node playwright/mcp/preflight-checkout-ux/probe.cjs
node playwright/mcp/preflight-checkout-ux/inspect-dev-indicator.cjs
```

Script dan log disposable, tidak ditrack:

- `playwright/mcp/preflight-checkout-ux/probe.cjs`
- `playwright/mcp/preflight-checkout-ux/report.json`
- `playwright/mcp/preflight-checkout-ux/report.md`
- `playwright/mcp/preflight-checkout-ux/initial-attempt.json`
- `playwright/mcp/preflight-checkout-ux/auth-diagnostic.json`
- `playwright/mcp/preflight-checkout-ux/dev-indicator.json`

Context7 checkpoint: `/microsoft/playwright/v1.62.1` — locator `getByLabel`/`getByRole`, viewport, route interception JSON, `serviceWorkers: 'block'`, dan screenshot dengan animasi disabled. Script memakai package/browser existing tanpa install atau config change.

## AC preflight → evidence

AC berikut menilai permintaan pemanasan tooling, terpisah dari AC01–AC10 audit lengkap.

| AC | Status | Evidence |
|---|---|---|
| PF01 — Periksa env tanpa membocorkan secret | Verified | Presence database/auth secret serta origin match pada `report.json`; nilai credential tidak dicetak. |
| PF02 — Browser lokal bisa diluncurkan | Verified | Chromium version tercatat; launch/close berhasil melalui Playwright lokal. |
| PF03 — Screenshot UI login desktop/mobile valid | Verified | PNG 1440×900 dan 390×844, signature/dimensi file diverifikasi script. |
| PF04 — Login seed dan session store valid | Verified | Submit form nyata HTTP 200; GET session menunjukkan authenticated/verified/onboarded, cookie prefix `client.*` tersedia. |
| PF05 — Checkout protected + screenshot desktop | Verified | Heading `Cara Pengiriman` tampil; cart/cabang dimock; viewport 1440×900 dan full-page 1440×1692. |
| PF06 — Resize dan screenshot checkout mobile | Verified | Viewport 390×844 dan full-page 390×2538; screenshot viewport diperiksa secara visual. |
| PF07 — Detail order protected dengan data demo | Verified | Heading `Detail Pesanan`, GET order diintercept, PNG mobile full-page 390×1971 diperiksa secara visual. |
| PF08 — Hasil pembayaran tanpa transaksi | Verified | Heading `Menunggu Pembayaran` pada result URL demo; PNG 390×844. |
| PF09 — Batas bisnis dan error runtime pada jalur contoh | Verified | Allowlist hanya auth/sign-in/session/sync nyata; cart/cabang/order API dimock, mutasi API lain diblokir; log jalur terakhir tanpa pageerror. Ini bukan jaminan seluruh state aplikasi bebas error. |

### Contoh screenshot pemanasan

Semua data bisnis pada halaman berikut adalah simulasi. Ini belum kumpulan gambar audit lengkap.

- [Login desktop](../../../playwright/mcp/preflight-checkout-ux/login-desktop.png)
- [Login mobile](../../../playwright/mcp/preflight-checkout-ux/login-mobile.png)
- [Checkout desktop — viewport](../../../playwright/mcp/preflight-checkout-ux/checkout-desktop-viewport.png)
- [Checkout desktop — full-page](../../../playwright/mcp/preflight-checkout-ux/checkout-desktop-full.png)
- [Checkout mobile — viewport](../../../playwright/mcp/preflight-checkout-ux/checkout-mobile-viewport.png)
- [Checkout mobile — full-page](../../../playwright/mcp/preflight-checkout-ux/checkout-mobile-full.png)
- [Detail pesanan mobile — full-page](../../../playwright/mcp/preflight-checkout-ux/order-mobile-full.png)
- [Hasil pending mobile](../../../playwright/mcp/preflight-checkout-ux/result-mobile.png)

Screenshot preflight tidak dipoles atau disembunyikan elemen development-nya; indikator Next.js dapat tetap muncul. Gambar tersimpan di folder gitignored dan tidak menjadi artefak permanen yang dijamin selalu tersedia.

## Temuan tooling dan keterbatasan

### 1. MCP tidak menemukan Chrome

Reproduksi `browser_tabs`: server MCP mencari Chrome pada path yang tidak tersedia. Alternatif Chromium bawaan Playwright berhasil. **Tidak memperbaiki konfigurasi MCP** atau menginstal Chrome; audit dapat memakai jalur alternatif ini tanpa bergantung pada MCP.

### 2. Locator login ambigu

Pada percobaan diagnostik, locator global tombol `Masuk` cocok dengan dua elemen setelah header dirender. Script diperbaiki menjadi locator tombol di dalam `form`, sesuai sumber halaman login. Request wait dan click ditangani bersama agar kegagalan click tidak menyisakan promise tak tertangani. Perubahan hanya pada script disposable, bukan aplikasi.

### 3. Capture saat compile belum selesai

Screenshot awal menampilkan `Compiling…`. Script terakhir menunggu teks indikator `Compiling`/`Rendering` hilang dan font siap sebelum capture. Pemeriksaan visual screenshot mobile terakhir menunjukkan indikator compile tidak lagi tampil, tetapi badge development **`2 Issues`** masih terlihat pada checkout. Detail kedua issue belum berhasil diperoleh; jangan mengklaim screenshot bebas overlay atau aplikasi bebas warning.

Diagnostik read-only terpisah pada login menemukan warning Next Image terkait perubahan width/height logo tanpa pasangan `auto`. Tidak ada pageerror pada diagnostik tersebut. Warning logo ini **belum terbukti identik** dengan dua issue pada checkout. Penelusuran warning aplikasi lebih lanjut bukan perbaikan otomatis dalam scope preflight.

### 4. Respons login awal HTTP 400

Percobaan pertama menghasilkan HTTP 400 sebelum diagnostik body error dipasang. Penyebabnya **belum diketahui** dan tidak boleh ditebak sebagai credential/env/hydration. Dua eksekusi berikutnya yang mencapai submit berhasil HTTP 200 dengan akun yang sama. Script terakhir memverifikasi isi input dan kecocokan payload tanpa mencetak credential; jika kejadian berulang, code/message error akan direkam secara teredaksi.

### 5. Cakupan belum membuktikan semua state

Belum memeriksa step review pembayaran, modal promo/alamat, quote delivery, seluruh recovery, semua status detail order, keyboard/contrast atau fixture audit lengkap. Keberhasilan ini membuktikan jalur dasar tooling dan akses, bukan AC audit lengkap atau integrasi provider. Tidak menjalankan unit/build/lint/full E2E karena tidak ada perubahan aplikasi.

## Keamanan dan perubahan

- Tidak ada seed/reset/schema sync, perubahan akun/onboarding, cart, alamat, order atau pemanggilan provider.
- Login nyata membuat session auth lokal; ini satu-satunya mutasi yang disengaja, sesuai izin user.
- Tidak menyimpan storage state/session token baru ke disk, tidak menampilkan credential atau cookie value.
- Browser context tertutup setelah eksekusi. Session auth server yang dibuat tidak dihapus manual; tidak mengubah DB untuk cleanup.
- API bisnis dimock/diblokir sebelum navigasi; page/layout yang dibuka ditelusuri agar tidak bergantung pada provider write server-side.
- Tidak ada perubahan aplikasi, env atau konfigurasi project; tidak ada commit/push/delegasi.

## Langkah berikutnya

Tooling dan akses dasar cukup untuk memulai audit melalui Chromium lokal **dengan caveat yang tercatat**. Draft audit tetap menunggu approval complete spec; preflight ini tidak mengubah statusnya menjadi Ready. Saat audit nanti, tunggu render stabil, gunakan locator terscope, simpan failure diagnostics teredaksi dan bedakan indikator development dari UI produk. Jika badge issue menghalangi evidence penting atau muncul error baru, diagnosis dahulu dan laporkan; jangan memoles/menutupinya diam-diam.
