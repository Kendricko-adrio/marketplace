# codebase-ui-audit

Navigasi artefak audit menyeluruh terhadap kualitas codebase dan UI/UX pada `apps/store`, `apps/admin`, dan `packages/*`. Aturan layout dan lifecycle: [panduan](../README.md).
Status plan hanya dicatat di sini. Status ticket tetap di masing-masing ticket.

## Status plan

| Plan | Status | Kesepahaman / approval | Verifikasi / blocker |
|---|---|---|---|
| [Slice 1 — P0 Security, Bug Fungsional & Lint Blocker](plan/slice-1-p0-security-bug-lint.md) | Done (2026-11-24) | Kesepahaman bersama & spec lengkap disetujui user (2026-11-24). | AC-1 s.d. AC-5 Verified: `@marketplace/ui` build PASS; `lint:store` & `lint:admin` 0 errors; `verify:types:store` & `verify:types:admin` PASS; unit slice 11/11 PASS (full `test:unit` 2.293 passed, 0 assertion failures; 9 guard file menolak DB `storefront` non-disposable); E2E mock 10/10 PASS (`addresses-mock`, `slice1-security-links-mock`, `slice1-security-shell-mock`). |
| [Slice 2 — Perbaikan UX Storefront, Mobile, Boundaries & Dark-Mode Safety](plan/slice-2-ux-store.md) | Done (2026-11-25) | Kesepahaman bersama dikonfirmasi via grilling (2026-11-24); spec lengkap disetujui user (2026-11-25). | AC-1 s.d. AC-6 Verified: `@marketplace/ui` build PASS; `verify:types:store` PASS; `lint:store` 0 errors; unit slice `infinite-products.test.ts` 2/2 PASS (full `test:unit` 2.295 passed, 0 assertion failures; 9 guard file menolak DB `storefront` non-disposable); E2E mock 29/29 PASS (`slice2-ux-store-mock`, `status-colors-mock`, `order-detail-presentation-mock`). Catatan: `checkout-review-mock` terblokir guard DB `storefront` non-disposable. |
| [Slice 3 — Perbaikan UX Admin, Standardisasi Bahasa, Mobile Drawer & A11y](plan/slice-3-ux-admin.md) | Done (2026-11-25) | Kesepahaman bersama dikonfirmasi via grilling (2026-11-24); spec lengkap disetujui user (2026-11-25). | AC-1 s.d. AC-6 Verified: `verify:types:admin` PASS; `lint:admin` 0 errors; `rg "window\.confirm" apps/admin/src/` = 0; E2E mock 29/29 PASS (`slice3-ux-admin-mock`, `customers-pagination-mock`, `status-colors-mock`). |
| [Slice 4 — SEO & Performance Storefront (SSR Detail Produk & CMS Cache)](plan/slice-4-seo-performance.md) | Done (2026-11-25) | Kesepahaman bersama dikonfirmasi via grilling (2026-11-24); spec lengkap disetujui user (2026-11-25). | AC-1 s.d. AC-4 Verified: `verify:types:store` PASS; `lint:store` 0 errors; unit slice 6/6 PASS (`get-product-detail.test.ts` 4/4, `pages/[slug]/page.test.ts` 2/2); full `test:unit` 2.301 passed / 0 assertion failures (9 guard file menolak DB `storefront` non-disposable); E2E mock `slice4-seo-performance-mock` 4/4 PASS. |

## Artefak

### research

- [Audit Codebase & UI/UX — Peluang Perbaikan Store & Admin](research/codebase-ui-improvement-audit.md) — temuan terverifikasi (P0 keamanan/bug/dead UI/lint, P1 UX/mobile/konsistensi/a11y/App Router boundaries, P2 arsitektur & maintainability, P3 performance & SEO), metrik baseline, open items, dan rekomendasi jalur tindak lanjut.

### plan

- [Slice 1 — P0 Security, Bug Fungsional & Lint Blocker](plan/slice-1-p0-security-bug-lint.md) — spec lengkap + technical & UX blueprint untuk P0-1, P0-3, P0-4, P0-5, dan P0-7.
- [Slice 2 — Perbaikan UX Storefront, Mobile, Boundaries & Dark-Mode Safety](plan/slice-2-ux-store.md) — spec lengkap + technical & UX blueprint untuk P0-2, P0-6, P1-1 (Store), P1-3 (Store), dan P1-4 (Store).
- [Slice 3 — Perbaikan UX Admin, Standardisasi Bahasa, Mobile Drawer & A11y](plan/slice-3-ux-admin.md) — spec lengkap + technical & UX blueprint + kontrak list/table untuk P1-1 (Admin), P1-2, P1-3 (Admin), dan P1-4 (Admin).
- [Slice 4 — SEO & Performance Storefront (SSR Detail Produk & CMS Cache)](plan/slice-4-seo-performance.md) — spec lengkap + technical & UX blueprint untuk P3-1 dan P3-2.

## Referensi terkait

- [docs/architecture/code-organization.md](../../docs/architecture/code-organization.md) — konvensi organisasi backend feature-first.
- [docs/features/status-colors.md](../../docs/features/status-colors.md) — kontrak warna status semantik store & admin.
- [ux-design index](../ux-design/index.md) — artefak UX design & warna status semantik.
- [maintainable-code index](../maintainable-code/index.md) — artefak standar maintainable code & contextual logging.
