# Implementation verification — tickets 01–07

## Delivery and review status

All seven tickets' application changes are implemented. The main agent reviewed the shared projection, server policy/guard reuse, scoped list intersections, confirmations, terminal handling and documentation. Tickets 01/03/04/05/06/07 have passed their focused verification. Ticket 02 remains claimed because its wider standard store/Pickup regression gate is not green; implementation and focused queue/history verification are complete. The overall plan remains **In Progress**, not Done, and its specification is retained.

No delegation, commit, push, remote/deployment action, live-provider write or schema/environment change was performed for this effort. Pre-existing unrelated working-tree changes were preserved. Test provider traffic was constrained to loopback mocks; production/provider credentials were not used for test writes. No screenshots were opened for diagnosis.

## Final reviewed results

Temporary execution logs were removed at the owner's request. These historical results are retained as a summary; cleanup did not rerun testing.

| Check | Result |
|---|---|
| Full unit suite (`npm run test:unit`) | **110 files passed; 1,099 tests passed, 2 skipped** |
| Full standard E2E (standard spec paths, excluding `*-mock.spec.ts`, loopback provider overrides) | **93 passed, 26 failed, 25 did not run** out of 144 |
| Full isolated provider-mock E2E (`npx playwright test --config=playwright.mock.config.ts --reporter=line`) | **49 passed** |
| Focused delivery UI scenarios after review fix | **12 passed**, including two auth setup tests |
| Focused general-history regression | **3 passed**, including two auth setup tests; subsequently passed in the final standard run |
| Changed admin TypeScript/TSX ESLint | Passed (exit 0) |
| Admin TypeScript (`npx tsc --noEmit --project apps/admin/tsconfig.json`) | Passed (exit 0) |

Full suites were run only in the final integration/review phase, after per-ticket focused checks. The reviewed full runs are summarized above. The isolated mock suite includes genuine provider-backed (mock-only) booking, follow-up, proof release/manual closure, store delivery/tracking and Pickup regressions; HTTP presentation fixtures alone are not used to claim backend effects.

## Review corrections and red → green evidence

1. **Dialog focus restoration:** the original browser scenario reproduced focus loss on dismissal; normal/special dialogs now return focus to the actual opener, falling back to detail reload when the opener disappeared. The focused regression passed after the fix.
2. **Unknown eligibility versus tracking hints:** a controlled booked detail with `eligibility.known=false` but separate tracking hints exposed two forbidden controls. The new public-browser regression failed with expected 0 / received 2. Tracking/handoff now share the same known-eligibility/current-access/stale/submission guard as special actions. The focused regression passed after the fix; the final standard and isolated mock runs used this fix.
3. **Existing follow-up selectors:** an already-packed order correctly offers booking, not another readiness action. A broad text selector also selected a hidden stage `<option>` rather than the visible failure summary. Tests now assert the booking action and semantic summary heading. Focused recheck passed both real follow-up journeys; the final isolated full suite passed all 49.
4. **Existing Orders list regression:** general history now explicitly opens `tab=all`, asserts current Home Branch names in the new column, and derives first-page badge expectations independently from 20 oldest DB rows. The test no longer moves all branch orders' creation times into an obsolete today-only default. Focused and final standard runs passed this scenario.

## Remaining standard-suite blockers — not classified as harmless

The final standard suite is **not green**. It contains catalog/customer expectations, hard-coded branch/fixture assumptions, sales-review setup and RBAC scenarios requiring further triage. No pre-implementation baseline run proves every failure pre-existing; do not describe the entire failure set as unrelated or waived.

Verified examples:

- `e2e/admin/orders.spec.ts:182`: `manualReviewOrderId` is empty before navigation. Read-only DB diagnostics confirm **zero** manual-review stock operations and absence of the legacy hard-coded Pickup order. The remaining serial detail/Pickup tests do not run after this failure. Controlled Pickup verification still passes in the isolated mock suite.
- `e2e/admin/rbac.spec.ts:44`: the test expects literal `Cabang Jakarta Pusat`; the actual current account/list uses `ADF OUTLET BOGOR`.
- `e2e/admin/sales-review-queue.spec.ts:32`: setup queries literal branch name `Cabang Jakarta Pusat` and then dereferences an absent row. Read-only diagnostics confirm zero exact branch-name matches.
- `e2e/admin/rbac-security.spec.ts:86–92` and `e2e/admin/users-rbac.spec.ts:192–195`: test branch selection falls back to the first row for Jakarta and independently selects the first non-Jakarta city. With **zero exact `Jakarta Pusat` city matches**, those expressions select the same branch, invalidating supposed cross-branch/branch-pivot scenarios. This explains why their 200-versus-404/403 assertions need fixture correction and re-verification, not an unreviewed authorization change.
- `e2e/admin/products.spec.ts:281`: no non-Jubelio fixture is found by that spec's list request. Store product-detail/listing cases also fail on expected catalog elements/fixtures. Other failures require their own root-cause investigation; they are not automatically covered by the branch explanation.

Read-only fixture diagnostics used counts/booleans only, not customer data or credentials; their findings are summarized above. The temporary detailed logs have been removed during requested cleanup. Playwright's shared `test-results` output is replaced by subsequent runs; fresh investigation requires new reports, not assumptions about old report paths.

### Next gate

Investigate and agree the scope of standard-suite fixture/baseline repairs before expanding beyond delivery implementation. Do not reset/reseed the owner's existing database, alter role/Home Branch rules to satisfy invalid fixtures, silently change product expectations, or claim full regression success. Re-run corrected standard regressions, then the final suites as needed. Resolve ticket 02 and retire the plan only after the required regression gate is satisfied.

## Enduring implementation documentation

- [Guided workflow](../../../docs/features/admin-delivery-workflow.md): navigation/queue membership, complete stage/guidance table, safe access, normal/special confirmations, evidence/money, read APIs and verification seams.
- [API reference](../../../docs/api-reference.md): work-list filters/counts, detail projection/preflights and existing follow-up additions.
- [Documentation index](../../../docs/README.md).

Caveat retained: current Midtrans deferral has no persisted authoritative verification-pending evidence. Ordinary pending orders remain Menunggu pembayaran; the projection must not invent Verifikasi pembayaran from a generic pending status.
