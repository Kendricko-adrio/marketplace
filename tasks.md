# tasks.md — Loop Engineering Starter

The loop picks the highest-priority task marked `[ ]` (pending), implements it,
verifies it, then moves it to `## Completed` with a one-line summary.

## Format
- [ ] task-id | title | priority: P1/P2/P3 | verify: <command or observable behavior> | description
- [x] task-id | title | priority: P1/P2/P3 | verify: ... | description   ← done → move to Completed

## Rules
- Checkbox `[ ]`/`[x]` is the SINGLE source of truth for status. No `status:` field.
- priority: P1 = bug/blocker, P2 = feature, P3 = nice-to-have. Loop picks lowest number first.
- `verify:` is the Definition of Done. If it can't be verified, the task isn't done.
- If a task can't proceed, move it to `## Blocked` with the reason — never leave it pending.
- Follow AGENTS.md: every task ships with tests (tdd skill), docs are part of the task.

---

## Tasks

### Bugs (P1)
- [x] task-001 | grey-out product card when zero stock in branch | priority: P1 | verify: unit test helper grey-out + `npm run test:unit` pass; manual: product tanpa stock di branch tampil grey-out di /products | pada searching product (contoh: http://localhost:3000/products), jika product ada di db tapi tidak ada stock sama sekali di branch → product card di-grey-out (opacity + add-to-cart disabled)

### Features (P2)
- [x] task-002 | revamp product detail metadata | priority: P2 | verify: /products/<slug> menampilkan brand, gender, kategori, harga (net + RRP), diskon, stock per branch; `npm run test:unit` pass | contoh url: http://localhost:3000/products/celana-olahraga-pria-puma-teamrise-short-red-white-704942-01-14198 — tambahkan field yang tersedia di db agar detail product tidak sepi metadata
- [x] task-003 | category search sebagai dropdown | priority: P2 | verify: dropdown kategori di /products?search= memfilter hasil & URL reflect selection; `npm run test:unit` pass | kategori di db banyak → gunakan dropdown, bukan checkbox

### E2E — semua fitur di docs/features/ (dekomposisi task-004)
> logging & jubelio-sync tidak E2E-able (infra/webhook) — dicover oleh unit test task-005-03 / 005-04.

- [x] task-004-01 | E2E storefront product listing | priority: P2 | verify: e2e/store/products.spec.ts lulus (`npm run test:e2e`) | infinite-scroll, product-filters, pricing-model: infinite scroll, sidebar filter, harga/diskon di card
- [x] task-004-02 | E2E product detail | priority: P2 | verify: e2e/store/product-detail.spec.ts lulus | pricing-model metadata (tergantung task-002)
- [x] task-004-03 | E2E cart & checkout | priority: P2 | verify: e2e/store/checkout.spec.ts lulus | order-flow, stock-reservation, vouchers: cart → checkout → place-order → order status; validasi voucher
- [x] task-004-04 | E2E onboarding | priority: P2 | verify: e2e/store/onboarding.spec.ts lulus | fresh user → /onboarding → selesai → cookie client.onboarding=1
- [x] task-004-05 | E2E static pages & footer | priority: P2 | verify: e2e/store/static-pages.spec.ts lulus | rendering halaman statis + footer di storefront
- [x] task-004-06 | E2E admin products & uploads | priority: P2 | verify: e2e/admin/products.spec.ts lulus | CRUD product, upload gambar, sync
- [x] task-004-07 | E2E admin orders & audit-log | priority: P2 | verify: e2e/admin/orders.spec.ts lulus | list/detail order, verify-pickup, entri audit-log
- [x] task-004-08 | E2E admin RBAC | priority: P2 | verify: e2e/admin/rbac.spec.ts lulus | halaman roles, guard permission, branch scope
- [x] task-004-09 | E2E admin analytics | priority: P2 | verify: e2e/admin/analytics.spec.ts lulus | metrik dashboard (extend dashboard.spec.ts)
- [x] task-004-10 | E2E admin notifications | priority: P2 | verify: e2e/admin/notifications.spec.ts lulus | long-poll, mark-all-read
- [x] task-004-11 | E2E admin CMS | priority: P2 | verify: e2e/admin/cms.spec.ts lulus | homepage-cms, static-pages, footer: editor admin + render storefront

### Unit test — semua API di apps/{admin,store}/src/app/api (dekomposisi task-005)
> Gunakan skill tdd; test di public seam (route handler / helper yang diekstrak), bukan internal.

- [x] task-005-01 | unit test store API catalog | priority: P2 | verify: `npm run test:unit` pass | products, products/[id], brands, genders, categories, branches, branches/[id]
- [x] task-005-02 | unit test store API cart & checkout | priority: P2 | verify: `npm run test:unit` pass | cart, cart/items, cart/items/[id], cart/validate-checkout, checkout/validate-step-2, checkout/place-order, checkout/order-status, internal/order-complete
- [x] task-005-03 | unit test store API payments & webhooks | priority: P2 | verify: `npm run test:unit` pass | payments/midtrans/create, webhooks/midtrans, webhooks/jubelio
- [x] task-005-04 | unit test store API account & misc | priority: P2 | verify: `npm run test:unit` pass | account/profile, orders, orders/[id], onboarding/sync, vouchers/validate, homepage, cron/sweep-reservations
- [x] task-005-05 | unit test admin API auth | priority: P2 | verify: `npm run test:unit` pass | auth/[...all], session-check, me, clear-must-reset
- [x] task-005-06 | unit test admin API catalog | priority: P2 | verify: `npm run test:unit` pass | products, products/[id], products/[id]/sync, brands, genders, categories, branches, branches/[id]
- [x] task-005-07 | unit test admin API orders & users | priority: P2 | verify: `npm run test:unit` pass | orders, orders/[id], orders/[id]/verify-pickup, users, users/[id], users/[id]/reset-password, permissions, permissions/me
- [x] task-005-08 | unit test admin API CMS | priority: P2 | verify: `npm run test:unit` pass | homepage, homepage/[id], homepage/reorder, homepage/preview-products, homepage/preview-all, pages, pages/[id], footer, linkable-destinations
- [x] task-005-09 | unit test admin API ops | priority: P2 | verify: `npm run test:unit` pass | analytics, audit-log, notifications, notifications/[id], notifications/mark-all-read, notifications/clear-all-read, notifications/poll, upload

## Blocked
(none)

## Completed
- task-001 | grey-out product card when zero stock | P1 | `/api/products` now returns `hasStock` (any variant × active branch with `stock - reservedStock > 0`, via `apps/store/src/lib/stock.ts` helper); ProductCard greys out (opacity-50, disabled link, "Stok Habis" badge); 7 unit tests; verified live on /products (zeroed a product's stock → card greyed, restored after)
- task-002 | revamp product detail metadata | P2 | detail page now renders category chips + season + kode artikel + selected-variant SKU alongside existing brand/gender/koleksi/price/RRP/discount/stock; discount via shared `computeDiscountPercent` helper (`apps/store/src/lib/pricing.ts`, 6 unit tests); verified live on /products/airrunner-pro-running-shoes
- task-003 | category search sebagai dropdown | P2 | Kategori filter restored as a native dropdown (1489 categories — checkbox list unusable); URL building extracted to `buildProductsQuery` helper (`apps/store/src/lib/product-filters.ts`, 7 unit tests); verified live: select → Terapkan → URL `/products?category=2-in-1&page=1`, results filtered to 2450
- task-004 | E2E specs (11/11) | P2 | 48 E2E tests across 11 spec files, full suite green twice (`npm run test:e2e`). Store: products (infinite scroll, filters, pricing, grey-out), product-detail (metadata), checkout (cart→place-order→Midtrans redirect, vouchers), onboarding (isolated fresh user via pg), static-pages+footer. Admin: products (list/detail/sync/upload), orders (verify-pickup + audit-log), rbac (roles guard, permissions, branch scope), analytics (metrics API), notifications (long-poll, mark-all-read), cms (homepage/pages/footer editor + storefront render). Side fixes: seeder now leaves AirRunner with zero stock (deterministic grey-out fixture); fixed real bug in notification provider (stale unread count after markAllRead — in-flight poll response overwrote the fresh count; poll loop now restarts with a fresh initial poll)
- task-005 | unit tests for all APIs (9/9) | P2 | 129 unit tests across 19 files, `npm run test:unit` green + both apps `tsc --noEmit` clean + full E2E suite still green after refactors. Logic extracted from route handlers into testable libs: `list-params` (products pagination/sort parsing, 6 tests), `pickup-validation` (checkout step-2 + place-order slot checks, 14), `order-finalize.describeFailureReason` (webhook failure mapping, 5), `midtrans.verifyMidtransSignature` (webhook auth, 4), `jubelio-webhook.verifyJubelioSignature` (webhook auth, 4), `vouchers.computeVoucherDiscount` (validate preview, 6), `auth-guard.getBranchScope` (admin scoping, 3), `permissions.checkPermission/getFirstViewableModule/HQ_PERMISSIONS` (admin guards, 7), `pickup-code.verifyPickupCode` (constant-time compare, 5), `homepage-content.validateContent` (CMS per-type zod, 14 — deduped from both homepage routes), `footer-config` schema (7 — deduped from footer route), `static-pages` schemas (9 — deduped from both pages routes), `notifications.getNotificationScope/buildScopeCondition` (4), `uploads.deleteFile` guards (6). Also fixed vitest alias resolution for `@marketplace/db/src/schema` in both app configs

---

