# Perbaikan stok storefront

## Cakupan disetujui

User menyetujui seluruh storefront dan rencana implementasi pada sesi ini: sembunyikan produk/cabang/kombinasi varian habis; harga dari varian tersedia; batasi quantity UI dan API termasuk quantity keranjang sebelumnya; URL langsung produk habis menampilkan `Stok habis`; tidak menghapus item keranjang lama otomatis; live check Jubelio saat checkout tetap berlaku. Tidak mengubah schema, reservasi, deployment, atau data Jubelio.

## Seam dan verifikasi

- Seam disetujui: HTTP API katalog/homepage/detail/cart dan browser Playwright dengan fixture stok terkontrol pada DB disposable + provider mock.
- TDD per slice: validasi cart → katalog/detail → homepage/UI; typecheck store, unit stock eksplisit, batch unit dan mock E2E terkait.
- Legacy `test:e2e` tidak dijalankan tanpa izin terpisah (berpotensi live writes).

## Context7 checkpoint

- `/drizzle-team/drizzle-orm-docs` — `onConflictDoUpdate.setWhere` membatasi update atomik dan transaksi mengembalikan hasil callback. `.for("update")` juga dikonfirmasi dari pola repo dan installed types Drizzle 0.45.x.
- `/reactjs/react.dev` — pilihan turunan dihitung dari ID, hindari state objek pilihan duplikat/stale.
- `/microsoft/playwright` — `BrowserContext.request` berbagi cookie session dengan browser; test API dan UI pada context yang sama.
- `/vercel/next.js` — `distDir` mengisolasi build mock E2E di `.next/mock`; include typegen ditambahkan pada tsconfig kedua app. Tidak mengubah build/deployment default.
- Next.js 16.3.x: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` — named HTTP handlers dan async params tetap sesuai API terpasang; tidak menambah API Next baru.

## Status

- [x] Regression cart stok nol, batas quantity dan request konkuren.
- [x] Katalog/search/detail hanya stok tersedia; pagination/harga konsisten.
- [x] Homepage manual/filter dan pilihan UI hanya stok tersedia.
- [x] Dokumentasi, review diff dan bukti verifikasi.

## Bukti verifikasi

- Red awal: API stok 0 mengembalikan 200, bukan 400; test quantity konkuren menerima ketiga request, bukan dua. Keduanya green sesudah perbaikan.
- Red katalog: count masih 4, bukan 1; red homepage masih menyertakan tiga produk habis. Green setelah filter sebelum count/limit dan proyeksi harga varian tersedia.
- Red UI: ukuran L tetap muncul pada warna Red; green setelah pilihan varian dihitung dari ID dan ukuran mengikuti warna.
- Red cart UI: DTO belum memuat `available`; green setelah DTO + batas tombol quantity ditambahkan. Item lama tetap ada saat stok turun.
- Red mapping: update item pada cabang nonaktif masih 200; green setelah query memeriksa cabang/mapping.
- L0: `verify:types:store` dan `verify:types:admin` lulus.
- L1: `verify:unit:slice -- apps/store/src/lib/stock.test.ts` — **1 file / 12 passed**.
- L2 unit: `verify:batch:unit` pada DB disposable terpisah — **148 files passed; 1704 passed / 12 skipped (1716)**. Skip tidak dihitung sebagai pass.
- L2 E2E: `verify:batch:e2e -- e2e/store/stock-visibility-mock.spec.ts e2e/store/markdown-mock.spec.ts` — **12 passed** (7 regression stok + 5 Markdown).
- ESLint pada 10 file implementasi store yang berubah lulus; `git diff --check` pada scope pekerjaan lulus.
- Log lengkap di luar repo: `/tmp/stock-batch-unit.log`, `/tmp/stock-batch-e2e.log`, `/tmp/stock-final-types-{store,admin}.log`, `/tmp/stock-lint.log`.
- Spec legacy products/detail/provisional diselaraskan dengan kontrak baru, tetapi tidak dieksekusi lewat legacy config. `npm run test:e2e` tetap belum dijalankan karena membutuhkan izin live-provider terpisah. Build/commit/push/deploy tidak dilakukan.
- Review scope/standards selesai: schema/reservasi/place-order tidak berubah; API memakai structured logging; docs API/fitur/testing diperbarui; test hanya memakai DB disposable/provider mock.
- Perubahan admin price-changes, plan parity, dan tambahan `price-change-prototype` di regex mock berasal dari pekerjaan lain yang muncul bersamaan, dibiarkan utuh dan bukan bagian perbaikan stok ini.

