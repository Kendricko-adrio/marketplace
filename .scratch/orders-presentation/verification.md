# Orders presentation follow-up

Owner-requested scope: standardize **only the Orders table design** against other admin tables, and stop Pesanan being highlighted together with Review Jubelio. No filter, column, query, pagination, action, permission, detail-layout or backend changes.

## Changes

- `apps/admin/src/app/admin/orders/page.tsx`: use the same shared Table/TableHead/TableCell/TableRow components as Products/Users; neutral header, shared padding/borders/hover and rounded-md frame. Existing content/actions and contained mobile scrolling remain.
- `apps/admin/src/components/AdminSidebar.tsx`: select only the longest matching visible route with segment boundaries; expose that link with `aria-current=page`. Review Jubelio is exclusive; ordinary order routes still activate Pesanan. Permission filtering is unchanged.
- `e2e/admin/orders-presentation.spec.ts`: independently compare visible table styling with Products, retain Pickup filters/link context and mobile containment; click Review Jubelio and verify exclusive visual/semantic selection, including ordinary detail and reviews-extra boundary cases.
- `docs/features/admin-delivery-workflow.md`: enduring presentation/navigation notes.

## Verification

Temporary execution logs were removed at the owner's request. Historical results are retained below; cleanup did not rerun testing.

- Table red reproduced different header text colour; the focused regression passed after the fix.
- Sidebar red reproduced both menus using the same active colour; the focused regression passed after the fix.
- First integrated recheck found an unsupported test-only `getByRole` option. Corrected the locator to the explicit ARIA current-page attribute; no further production change was necessary.
- Final focused E2E: **14 passed** (12 UI scenarios + two existing auth setup tests), covering new presentation/sidebar regressions and existing delivery queue/detail/action journeys.
- Full unit suite: **110 files passed; 1,099 tests passed, 2 skipped**.
- Changed app-file ESLint and admin TypeScript: passed.

Current Next.js usePathname documentation was verified through Context7 and the installed API guide; shared Table styles were inspected in `packages/ui/src/components/ui/table.tsx`. Main-agent review confirmed changes stay inside the requested UI scope. No screenshot was opened for Playwright failure diagnosis, and no commit/deployment was performed. Unrelated worktree changes and the earlier wider standard-E2E verification gate are retained; that full standard suite was not rerun or claimed green for this small follow-up.
