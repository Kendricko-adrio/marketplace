# Compact Operations — disposable Next.js prototype

**UI exploration only. Not production implementation or complete-spec approval.**

Owner authorized a Next.js prototype, explicitly excluding changes to existing implementation code. This standalone scratch application keeps that boundary: it does not import store/admin application code, auth, database, API routes, provider clients, or environment files. The sidebar/header imitate the existing admin context and the palette follows `apps/admin/src/app/globals.css`; they are not the live authenticated shell.

## Run

From the monorepo root after the existing workspace dependencies are installed:

```bash
npm --prefix .scratch/admin-delivery-workflow/prototype run dev
```

Open **http://127.0.0.1:3012**. This is separate from store (3000) and admin (3001), and binds only to localhost. No additional install or database setup is needed. Stop the foreground server with Ctrl+C.

All prototype files and generated `.next` output remain in this directory. No root package script, workspace registration, lockfile, deployment file, or application route was changed. Generated output and the local dev log are ignored here.

## Question being explored

Can a compact order queue and evidence-aware detail let branch staff identify the next safe task without crowding the page or confusing normal actions with exceptional handling?

One **Compact Operations** direction was requested, not three competing designs. Visual layout/density is proposed, not approved product behavior.

## Try it

1. Start at Delivery / Perlu dikerjakan. Search by reference/customer; filter delivery stage, origin branch or creation date. **Tahap delivery** defaults to **Semua tahap** and intersects the selected queue and other filters; it never pulls an order in from another queue. For example, Perlu dikerjakan + Siapkan barang shows only preparation work. Queue/stage combinations with no matching fixtures show an empty state. The stage filter remains selected on return from detail, and date base totals preserve the stage restriction. Clear a date filter to restore the same-stage mock queue.
2. Open ORD-2610-0001. Simulate readiness, booking review, and physical handoff; inspect the persistent next step after each confirmation.
3. Use the bottom **Scenario** selector for booking unknown. Release requires dummy reference/reason and both acknowledgements. Release only returns the fixture to ready; booking is a separate confirmation.
4. Compare outstanding dispatch: no release or rebooking control.
5. Open a Bandung order, then select Jakarta or Tanpa edit in **Viewer**. Stage remains truthful while normal/special actions and provider-refresh simulation disappear.
6. Enable **Simulasi reload gagal**, then use Muat ulang detail. A stale explanation appears and normal actions stay hidden until a successful simulated read.
7. Compare Barang diterima with Selesai manual. Use the returned fixture's special handling to inspect the manual-finish confirmation and required reason.
8. Resize to mobile. The order table intentionally scrolls horizontally inside its container; detail stacks vertically.
9. Reset demo or reload the browser. Changes are in memory only and are discarded.

## Owner feedback explored

- Owner liked the visual direction and requested stage filtering, including **Siapkan barang** only. Added the **Tahap delivery** dropdown to the prototype filters. This is a prototype refinement only: the complete specification and implementation code remain unchanged. Incorporating the new filter into the production contract requires a separate scope/acceptance update before implementation.

## Boundaries / known limitations

- All names, addresses, goods, AWBs, dates, costs and evidence are fictional; missing evidence stays labelled unavailable.
- No fetch, server action, provider create, real tracking request, storage, or persistence. The Next.js dev runtime itself makes its normal local framework requests.
- Queue membership is a mock presentation approximation, not the production follow-up service or authorization engine. Monitoring/follow-up overlap is demonstrated using the handed-over fixture.
- Follow-up is represented in the same mock table; no live follow-up route or independent case ledger is created.
- Viewer controls are review tools, not authentication. Server authorization, concurrency, attempt-bound proof validation and at-most-once booking are not implemented or proven.
- The special manual-finish fixtures explicitly assume the existing complete guards. UI controls do not establish eligibility for real orders.
- Pagination is illustrative: 15 fixtures, one page, disabled previous/next. This does not prove server totals or multi-page ordering.
- Pickup is a clearly labelled placeholder, not a redesign of pickup verification. Semua contains only this prototype's delivery fixtures, not the live general order search.
- No packing-failure reporting form, full policy-unavailable screen, every courier status, or automatic courier-progress simulation is included. Select existing scenarios to compare waiting, transit and completion.
- No external fonts, images, or services are loaded. The existing admin palette and a platform UI font keep the prototype self-contained.
- No production rollout, commit, delegation, spec-status transition, or implementation ticket was authorized/performed.

## Inspection performed

Local Chromium browser inspection through Playwright (the MCP browser required unavailable Chrome, so installed Playwright Chromium was used):

- Readiness → booking → handoff confirmations and resulting guidance.
- Incomplete proof submission disabled; complete dummy proof release returns to ready without auto-booking.
- Outstanding dispatch explanation without release/rebooking.
- Manual finish reason required and distinct manual result.
- Cross-Home viewer and failed reload hide normal actions.
- Creation-date count example: 5 matching out of 15 fixtures; queue/date retained on return.
- Browser reload resets mock data.
- 1440px desktop and 390px mobile viewport checks; corrected a screen-reader-only table heading that initially caused document overflow. Table scrolling remains inside its container.
- No page runtime errors or external network requests observed during the inspected normal/read-only/stale scenarios.

These are prototype smoke observations, **not** AC01–AC33 acceptance results, production tests, or verification of backend guards. No production unit/E2E suite, build, lint, or typecheck was run; existing implementation was not changed.

## Sources

- `../assets/04-guided-detail-wireframes.md`
- `../assets/05-exception-guidance-and-read-only-access.md`
- `../../../.scratch/admin-delivery-workflow/plan/admin-delivery-workflow-spec.md`
- Local installed Next.js documentation: `node_modules/next/dist/docs/01-app/01-getting-started/01-installation.md`, `01-app/03-api-reference/01-directives/use-client.md`.
- Context7 `/vercel/next.js`: root App Router layout and client component guidance, consulted before authoring.

Keep this throwaway. Record owner feedback before any separate production implementation; do not promote prototype code directly into the apps.
