# Verifikasi modal pemilihan promo checkout

## Scope dan hasil

Implementasi mengikuti approval user “oke sudah oke plannya. tolong eksekusi”.
Referensi: [plan](../plan/checkout-promo-modal.md).

- Ringkasan checkout tidak lagi merender daftar/input kode inline.
- Modal menyediakan draft satu promo publik atau kode, Periksa kode read-only,
  Gunakan promo, pagination 10 item, daftar scrollable, footer tetap terlihat.
- Ranking global eligible/estimasi total terendah memakai evaluator existing,
  termasuk PPN, benefit aktual, cap, expiry, dan tie-break deterministik.
- Pilihan aktif diproyeksikan terpisah dari halaman; pagination bukan invalidation.
- Konfirmasi kenaikan total berada di tahap modal yang sama; Batal kembali ke
  draft. Pelepasan promo tetap memakai konfirmasi existing.
- Error, empty, stale apply sesudah Escape, kode diedit, keyboard radio/focus trap,
  review-required, manual/public, pickup/delivery, dan acknowledgement diuji.

## RED → GREEN

1. `promo-ranking.test.ts`: RED karena module ranking belum ada; GREEN pada
   contoh literal diskon barang Rp10.000 → total Rp115.900, subsidi Rp11.000 →
   total Rp116.000. Dilanjutkan cap percentage dan tie-break.
2. E2E `modal promo: daftar scrollable...`: RED karena tombol Pilih promo belum
   tersedia pada UI lama; GREEN setelah modal + draft/pagination diterapkan.
3. Service malformed shipping: 4 RED (jalur lama sempat membaca cart), kemudian
   8/8 GREEN setelah validasi ongkir sebelum persistence.
4. Regression failure dianalisis melalui **Markdown error context**, bukan image
   attachment. Penyesuaian test meliputi locator radio menggantikan tombol lama,
   background `includeHidden` ketika Radix membuatnya aria-hidden, dan Batal
   tahap kenaikan kembali ke picker. Kesalahan fixture constraint/ceil juga
   diperbaiki berdasarkan constraint/schema dan literal pembulatan yang benar.
5. Ditemukan nested Badge div dalam paragraph ringkasan; diperbaiki menjadi div
   dan span nama. Lint refs render diselesaikan dengan context state adjustment
   dan invalidation pada layout effect, bukan menonaktifkan aturan lint.

## Lingkungan dan batas izin

- PostgreSQL disposable baru: `marketplace_discounts_test_promo_modal_20260218`.
  Schema diterapkan dengan db:push dan seed demo; DB utama tidak diubah.
- Provider dibatasi loopback melalui `playwright.mock.config.ts`, fake credentials,
  dan gate test existing. Tidak ada provider live, SSH, remote, deployment, commit,
  atau subagent.
- Root Vitest terblokir oleh referensi existing ke file yang tidak ada:
  `scripts/vitest.config.mts`. Tidak mengubah config repo untuk memperbaiki hal
  unrelated. Focused run memakai config store langsung. Batch memakai temporary
  config `/tmp/promo-vitest-workspace.mts` dengan keenam workspace existing,
  mengecualikan hanya project scripts yang memang tidak ada.

## Bukti checks

| Gate | Hasil | Bukti disposable |
|---|---|---|
| Full unit enam workspace serial | **163 file PASS; 1.766 passed, 12 skipped** | `/tmp/promo-batch-unit.log` |
| Validasi ongkir tambahan setelah batch | **8 passed**, termasuk empat kasus baru; bukan klaim full suite dijalankan ulang | `/tmp/promo-shipping-green.log` |
| DB discovery/ranking/pagination | **7 passed, 1 guard skipped** pada DB disposable, termasuk terbaik di luar 25 nama pertama | `/tmp/promo-db3.log` |
| Typecheck store akhir | PASS | `/tmp/promo-final-types.log` |
| ESLint seluruh file implementasi terkait + DB test | PASS, tanpa warning | `/tmp/promo-final-lint.log` |
| Whitespace diff | `git diff --check` PASS | command langsung |

Total unit batch sebelum empat kasus baru adalah 1.766; jangan menyebut angka
1.770 sebagai hasil satu full run. Guard skip dicatat, bukan dihitung PASS.

### Playwright: 38 kasus unik PASS pada dua spec terkait

Batch pertama tidak langsung hijau. Suite serial menghentikan beberapa kasus
setelah failure; hanya failure/belum berjalan dan state baru yang di-recheck,
bukan mengulang seluruh kasus yang sudah PASS tanpa perubahan relevan.

| Run | Kasus unik baru yang PASS | Log |
|---|---:|---|
| Batch dua spec, mengecualikan modal pagination yang sudah diuji terpisah | 25 | `/tmp/promo-batch-e2e.log` |
| Recheck percentage, manual×percentage, paid-blocked, kandidat unavailable | 4 | `/tmp/promo-recheck.log` |
| Recheck delivery 1280/390 dan context-changed | 3 | `/tmp/promo-recheck2.log` |
| Manual code lifecycle tersisa | 2 | `/tmp/promo-manual-recheck.log` |
| Modal pagination/scroll/draft lintas halaman | 1 | `/tmp/promo-e2e-green.log` |
| Modal draft kode/edit/stale Escape + error/empty/retry/kontrak HTTP | 2 | `/tmp/promo-final-state-e2e.log` |
| Keyboard radio/focus trap/footer pada viewport pendek | 1 | `/tmp/promo-keyboard.log` |

Jumlah 38 adalah **union kasus unik dari batch dan focused recheck**, bukan
klaim satu run 38/38. Dua spec: `e2e/store/discounts-coupon-mock.spec.ts` dan
`e2e/store/checkout-review-mock.spec.ts`. Tidak membuat spec baru/testMatch baru.

## Review UX oleh main agent

Main agent membaca hasil render aktual yang diambil dari passing browser runs,
bukan failure attachments. Dibandingkan modal promo dengan peer **Alamat baru**
pada checkout yang sama:

- `playwright/mcp/promo-modal/modal-360.png`
- `playwright/mcp/promo-modal/modal-1440.png`
- `playwright/mcp/promo-modal/checkout-summary-1440.png`
- `playwright/mcp/promo-modal/reference-address-360.png`
- `playwright/mcp/promo-modal/reference-address-1440.png`

Typography, warna semantic, border, field, button, overlay, dan radius memakai
shared component/token existing. Promo sengaja memakai header/footer tetap dan
radio list untuk tugas pemilihan; tidak mengubah shared Dialog/token. Daftar
panjang hanya berada di modal, action tetap terjangkau; ringkasan checkout tetap
ringkas. Pemeriksaan interaksi mencakup viewport 1280/390 pada delivery,
360/1440 pada modal, dan **360×500** untuk footer pendek, native arrow-key radio,
Tab/Shift+Tab focus trap, Escape, serta focus restore ke trigger.

Batas bukti: bukan usability study, bukan sertifikasi WCAG, dan tidak menguji
keyboard virtual pada perangkat fisik. Desktop resize bukan bukti perilaku IME
mobile nyata. Screenshot full-page dapat menempatkan sticky header pada posisi
scroll saat capture; header adalah perubahan working tree lain dan tidak diedit.

## Catatan implementasi dan skala

- Numbered mode memakai pembacaan kandidat publik aktif dan client usage dalam
  batch; tidak memanggil preview/provider atau query per kandidat. Context,
  Markdown, dan PPN reuse sumber existing. Fixture 27 tambahan membuktikan
  ranking tidak dibatasi legacy page 25; belum ada production load benchmark/SLA.
- Kandidat manual menggunakan kode + nominal aktual tervalidasi. Preview existing
  tidak mengembalikan metadata minimum/expiry/nama Offer manual, dan kontraknya
  tidak diperluas; tidak mengarang syarat atau membocorkan kode privat lain.
- Perubahan checkout context membuang kandidat draft gagal, mempertahankan promo
  aktif lama untuk revalidasi pada review baru; test expectation diperbarui dari
  auto-select kandidat stale menjadi preserve applied selection.
- `npm run test:e2e` legacy/live **tidak dijalankan** karena membutuhkan izin
  terpisah. Build produksi/commit/deploy bukan bagian sesi ini. UAT customer tetap
  dapat dilakukan pada fitur ini tanpa mengubah gate rollout otomatis.
- Perubahan working tree lain yang sudah ada sebelum tugas dipertahankan.

Dokumentasi permanen diperbarui di `docs/features/discount-redemption.md` dan
`docs/api-reference.md`. Artefak plan/evidence tetap disimpan.
