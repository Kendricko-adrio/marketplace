# 01: Evidence-aware detail foundation and safe viewer access

Type: task
Status: resolved
Label: ready-for-agent
Blocked by: none
Parent: [Implementation effort](../map.md)
Specification: [Approved complete contract](../../../plan/admin-delivery-workflow-spec.md)

## What to build

An authorized Admin User can open an existing delivery detail in the accepted Compact Operations hierarchy, understand its current evidence-based stage and safe next step, and see truthful reasons why actions are unavailable. Establish the reusable stage/view-access contract through this demoable detail experience, not a backend-only refactor. Preserve existing fulfillment actions until their guided presentation is refined in later slices; never weaken existing guards.

## Acceptance criteria

- [ ] The detail lives in the actual authenticated admin shell. No mock user/workspace, scenario toolbar, reset control, prototype banner, fixture date or dummy evidence reaches production.
- [ ] Current order evidence produces every approved stage and persistent guidance in specification section 4. Payment/settlement, readiness, booking, handoff, pickup/transit, verified arrival, manual closure, packing failure and booking dispatch/unknown remain distinct.
- [ ] Terminal outcomes suppress active task guidance; courier progress takes precedence over an absent manual handoff stamp. Missing intermediate evidence never becomes a fabricated milestone or mandatory backfill.
- [ ] A reusable safe projection gives list/follow-up/detail the same stage meaning without new lifecycle enums or a parallel eligibility engine. Current server policy and complete existing guards remain authoritative.
- [ ] Verified missing edit permission, absent Home Branch and mismatch receive the approved specific explanations, together if multiple apply. Order stage remains truthful; normal/special mutation controls and guarded provider refresh are unavailable to unauthorized viewers.
- [ ] When view access is valid but action eligibility is unknown, use the approved reload guidance, no guessed Home Branch denial and no mutation controls. Policy-Unavailable State instead hides protected navigation/data under existing fail-closed behavior.
- [ ] The next-step/blocker panel is prominent; payment and stage are visually distinct. Details preserve immutable context and separate technical diagnostics. Keyboard navigation, accessible names/focus and small-screen stacking follow AC38–AC39.
- [ ] Projection/policy data is safely scoped and contains only necessary authorized summaries, not raw provider errors or secrets. Customer privacy boundaries remain unchanged.
- [ ] Deterministic public-seam coverage verifies all approved stage conditions and viewing restrictions; admin Playwright verifies visible detail, read-only reasons and unavailable-policy behavior. Update corresponding enduring documentation and log changed API success/failure through the structured logger.

## Verification focus

Principal mapping: AC06–AC07 stage meaning, AC26–AC27, AC31–AC32, AC38–AC39 and the full section 4 stage table. Use independent controlled evidence/Current Policy fixtures; test the public projection/read contract rather than private component state or a query-builder implementation. Reuse existing detail/booking/follow-up browser seams and server authorization tests.

## Boundaries and handoff

No separate menu, generic status-to-permission shortcut, new operational policy, auth redesign, schema lifecycle redesign or prototype promotion. Later tickets cover queue integration and action-specific confirmations; this ticket must still be independently usable and safe. Read the common implementation/verification contract in the parent map. Execution was subsequently requested by the owner for tickets 01–07.

## Answer

Implemented the shared stage/access projection and persistent delivery detail guidance in the live admin shell. Detail GET resolves edit/Home Branch reasons and runs a read-only preflight through the existing packing guard. Settlement interpretation is shared with packing, no provider call or new schema. Unknown projection hides actions; current policy failure hides data. Delivery no longer uses the Pickup status stepper. Mobile shell/navigation stacks to contain 390px detail.

Verified: focused projection + PostgreSQL fulfillment tests **29 passed**, admin typecheck and changed-file ESLint passed; dedicated detail Playwright **2 passed** (read-only, unknown eligibility, mobile, policy-unavailable). The initial database run skipped 7 tests while PG was offline; after owner started PG, all relevant database tests passed. Initial browser failure came from a stale seeded order ID; independent HTTP presentation fixtures replaced that dependency. Mobile overflow exposed the desktop-only flex shell and was fixed/rechecked. Final shared verification, including the unknown-eligibility tracking-hint regression, is recorded in [verification.md](../verification.md).

Review: mutations retain server guards; no customer DTO or deployment change. Subsequent tickets refine normal/special confirmations, queue integration and evidence hierarchy. `Verifikasi pembayaran` is supported only for explicit verification-pending evidence: the current Midtrans defer path persists none, so no pending order is falsely assigned that stage. See `docs/features/admin-delivery-workflow.md`.
