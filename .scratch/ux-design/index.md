# ux-design

Navigasi artefak fitur ini; aturan layout dan lifecycle: [panduan](../README.md).
Status plan hanya dicatat di sini. Status ticket tetap di masing-masing ticket.

## Status plan

| Plan | Status | Kesepahaman / approval | Verifikasi / blocker |
|---|---|---|---|
| [Warna status semantik store/admin](plan/semantic-status-colors-spec.md) | Done (2026-11-14) | Dokumen lengkap disetujui user pada 2026-11-14: “oke saya approve specnya”. User juga memilih opsi “Buat DB disposable baru lalu push+seed” untuk gate verifikasi. | Implementasi terintegrasi dan gate dijalankan. Bukti: unit slice `apps/store/src/lib/status-presentation.test.ts` 59 test PASS; `npm run verify:batch:unit` (full unit, `--no-file-parallelism`) 202 file / 2432 test PASS, 25 skip; `e2e/store/status-colors-mock.spec.ts` 11 test PASS; `e2e/admin/status-colors-mock.spec.ts` 17 test PASS; `verify:types:store` + `verify:types:admin` PASS; lint kedua app tanpa error dan tanpa warning baru. Regresi mock: `order-detail-presentation` dan `order-notifications` PASS; suite lain hanya gagal pada fixture environment (grant RBAC, produk/offer seed, 2 cabang ber-`jubelio_location_id`) — bukan regresi warna. Batasan tercatat di [docs/features/status-colors.md](../../../docs/features/status-colors.md) §9. |

Artefak legacy dipertahankan tanpa mengasumsikan approval, Ready, atau Done. Rekonsiliasi acceptance dan bukti tetap diperlukan untuk artefak lama.

## Artefak

### plan

- [Spesifikasi warna status semantik store/admin](plan/semantic-status-colors-spec.md) — scope halaman, mapping/palet light–dark, blueprint teknis/UX, dan acceptance/verification. Status implementasi: Done, evidence di tabel plan di atas dan pada §11/§15 dokumen.

### research

- [research/ux-design-research.md](research/ux-design-research.md)
- [Audit warna dan label status store/admin](research/status-colors-audit.md) — audit source dan screenshot, rekomendasi palet beserta contrast, inventaris lintas surface, serta evidence pembaruan skill. Research hanya mengubah dokumentasi; UI belum diubah. Approval spec tindak lanjut tercatat pada tabel plan di atas.

## Dokumentasi permanen terkait

- [docs/features/status-colors.md](../../../docs/features/status-colors.md) — kontrak token, resolver domain, `StatusBadge`, aggregate import/bulk, fallback, cara menambah status, dan batasan yang diketahui.
