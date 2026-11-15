# markdown-pricing

Navigasi artefak fitur ini; aturan layout dan lifecycle: [panduan](../README.md).
Status plan hanya dicatat di sini. Status ticket tetap di masing-masing ticket.

## Status plan

| Plan | Status | Features | Notes / Outcome |
|---|---|---|---|
| [Import Excel nominal dan persen](plan/import-excel-nominal-persen.md) | Done | 3 slice | 2026-10-26: workbook `markdown_v2` (`sku/action/new_price/input_type`, SKU Text, dua contoh dummy terlindungi, v1 tetap dibaca), staging persen freeze half-up + metadata, review kolom Input, laporan/retry pertahankan mode, docs fitur+API diperbarui. Bukti: [verifikasi](ticket/01-verifikasi-import-excel-nominal-persen.md) — types admin PASS; codec 32 pass; DB serial 81 pass; mock E2E harga 14/14 pass (1 rerun setelah flake warmup); render desktop/mobile + UNO leading-zero; sibling `versioned-pricing` 100/100 saat final. Legacy E2E tidak dijalankan (butuh izin); `verify:batch:unit` penuh diulang sebelum commit. | Mencakup SKU Text, dua contoh dummy, petunjuk action, mode nominal/persen, kompatibilitas workbook dan report/retry. Belum ada implementasi atau verifikasi. |
| [Pemulihan UX Harga Admin sesuai Prototype](../../docs/features/markdown-pricing.md#81-pemulihan-ux-sesuai-prototype--2026-10-22) | Done | 3 | 2026-10-22: tabel/selection terpadu, dialog manual/bulk/restore/review/history, target nonaktif global, dan Import & batch terpisah dengan theme existing. Unit/DB slice 34 pass; batch unit 1704 pass/12 guard-skip; affected mock E2E 19 pass; types PASS; scoped lint 0 errors (3 existing download warnings); browser desktop/mobile dibandingkan. Docs fitur/API diperbarui. Tanpa subagent/commit/deploy/provider live; gate UAT/rilis plan diskon existing tetap terpisah. |

Catatan status dan hasil test di atas dipindahkan dari index lama, bukan verifikasi baru.
Plan Done yang dahulu sudah dihapus tidak direkonstruksi; outcome dan docs tetap tersedia.

## Artefak

- [Spesifikasi import Excel nominal dan persen](plan/import-excel-nominal-persen.md): complete spec disetujui, implementasi selesai dan terverifikasi.
- [Bukti verifikasi implementasi](ticket/01-verifikasi-import-excel-nominal-persen.md): ladder, bukti spreadsheet/browser, blocker sesi lain, keputusan kecil tercatat.

Rujukan enduring docs untuk plan Done ada pada outcome di atas.

- [Filter status harga coret — scope percakapan dan verifikasi](ticket/verifikasi-filter-status-harga-coret.md):
  approval implementasi diberikan pengguna di percakapan. Perubahan kecil satu
  sesi tanpa plan/ticket breakdown. Pada 2026-10-26, filter Semua/Sudah disetup/
  Belum disetup terpasang; backend 35 pass, mock E2E 7 pass, types admin dan
  scoped lint PASS, rendered UI desktop/mobile direview. Regression global
  belum hijau: 1866 pass, 9 fail checkout store, 12 skipped; detail pada bukti.
