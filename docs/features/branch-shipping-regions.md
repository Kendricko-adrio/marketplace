# Verified branch Shipment regions

Every admin branch create/edit, including inactive and pickup-only branches,
requires province → city/kabupaten → district/kecamatan → village/kelurahan
selection from Jubelio Shipment. The village supplies Area ID and read-only
postcode. This does not change the general branch `city`/`address` or the
Omnichannel identity `jubelioLocationId`.

## API and authorization

`GET /api/admin/shipment/regions?level=provinces|cities|districts|areas&parentId=...`
requires an admin session with `branches:edit`. Province lookup needs no parent;
other levels require a 1–16 digit string. Response: `{ success: true, data: [{ id,
name, parentId?, postalCode? }] }`. Invalid query is 400; timeout, provider failure,
or malformed provider data is 503 with a safe retry message. Provider GETs require
no login/token. Admin owns its URL and logger; it never calls a store-auth route.

`POST /api/admin/branches` and `PUT /api/admin/branches/{id}` require all five
string fields on **every** request:

- `shippingProvinceId`, `shippingCityId`, `shippingDistrictId`, `shippingAreaId`
  (1–16 digits, leading zeros preserved);
- `shippingPostalCode` (3–10 digits).

Missing/null/empty/malformed values, unknown IDs, cross-parent combinations and
postcode mismatches are 400. The server verifies every level against Shipment,
then stores provider names in `shippingProvince`, `shippingCity`,
`shippingDistrict`, `shippingArea`. Browser-supplied names are ignored. Provider
failure is 503 and writes neither branch nor Audit Event. Old API clients must
supply the hierarchy; omission no longer preserves region configuration.

Creation still requires edit-all. Own-branch editing remains pinned to Home
Branch; foreign/missing targets remain 404 before region validation. Branch
mutation and region before/after audit share one transaction, using the locked
row for update audit values. Omitted phone/address still remain undefined during
PUT, preserving the current locked-row values rather than stale pre-check data.
Supplied sender values retain their existing validation. Logs omit sender PII,
submitted schema values, credentials and raw provider payloads.

## Form and rollout

Parent changes clear every descendant and postcode, including same-postcode
villages. Loading, errors, unavailable saved options, mismatched saved postcode,
incomplete selection and pending submission block saving. Errors offer explicit
retry without clearing unrelated inputs. Superseded responses are aborted and
ignored. A saved option is never silently substituted.

Migration `0033_wild_ben_grimm.sql` adds nullable local hierarchy IDs/names.
Legacy/import rows remain unconfigured, even with an old manually entered Area
ID. Editing shows a completion notice. There is no backfill, inference from IDs,
Omnichannel suggestion, postcode correction or deactivation. Seeder deliberately
retains unconfigured branches. All shipping fields remain excluded from Jubelio
sync insert/conflict-update allowlists, including active/inactive status sync.

Region configuration alone is not delivery readiness: active status, sender
phone/address and usable parcel configuration remain required. New quote and
checkout approval reject incomplete regions before rates calls. Requests always
include the chosen origin `area_id`. Quote service `originFingerprint` binds
approval to the stored IDs, names and postcode; send it unchanged at order
placement. An origin change requires fresh approval even if pricing is identical.
Pickup and already accepted immutable order snapshots/fulfillment remain intact.

Admin mock E2E covers create/edit/reopen, canonical persistence, legacy completion,
retry, unavailable saved villages, same-postcode reset and delayed-response races.
API tests cover strict validation, provider failures, canonical strings,
transactional audit and Home Branch scope. Delivery unit/E2E tests cover missing
origin rejection and stale-origin approval. All provider verification is controlled
and loopback-only; deployment/live-provider activation requires separate approval.

## Completion verification and accepted exception

Local implementation completed on 2026-10-05. Verification performed:

- `npm run test:unit`: 109 files passed, 1074 tests passed, 2 existing infrastructure sentinels skipped.
- `npm run test:e2e -- --config=playwright.mock.config.ts`: full isolated mock suite, 49/49 passed.
- Admin/store/shared DB `tsc --noEmit`, `db:check`, focused changed-file lint and diff whitespace checks passed. Full admin lint had no errors and 26 existing warnings.
- Migration was generated and applied locally with `db:push`, without a database reset.

The user explicitly accepted the existing full-store lint failure at
`apps/store/src/components/Header.tsx:39` (`react-hooks/set-state-in-effect`)
as a completion exception. The error remains unfixed; this is not a claim that
full store lint passed. Default shared E2E was not run because it does not
isolate Shipment/Sales traffic; the full isolated mock config was used instead.
No live quotes/bookings, commits, push, remote actions or deployment were performed.
This closure updates documentation only; tests were not rerun for the exception.
