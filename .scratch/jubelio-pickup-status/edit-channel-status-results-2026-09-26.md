# Paid SO `channel_status` edit probe — 2026-09-26

Owner approved a bounded, one-session test on a fresh, test-owned INTERNAL SO; the consumed test proposal was retired during scratch cleanup. Approval covered at most one create, one invoice conversion, one payment, and one full-payload SO edit, each GET-verified with stop-on-ambiguity gates, and did not include retries or cleanup. Used the configured `https://api2.jubelio.com` test-account opt-in; that flag and previous notes describe a test account but **do not independently prove isolation from real commerce**. No Midtrans request or charge, application-code change, SSH/deployment, or writes to existing SOs. The local [redacted one-shot journal](edit-channel-status-run.jsonl) contains stage/ID/status/stock observations only; the retired harness had an exclusive journal-creation guard. Do not rerun the experiment. Credentials, tokens, customer payloads and raw provider bodies were not recorded.

## Exact provider writes (one each, all HTTP 200)

| Step | Path | Outcome |
|---|---|---|
| Create | `POST /sales/orders/` | NEW INTERNAL SO **68398**, item **43842** at location **7**, qty **1**, price **1000**, initial `channel_status="Belum Bayar"`, independently confirmed by GET. |
| Invoice | `POST /sales/packlists/create-invoice` | Invoice **45944**; GET invoice and SO confirmed linkage, generic test contact/location, qty/item/money. |
| Payment | `POST /sales/payments/` | Payment **26**; GET payment confirmed exactly one association with invoice **45944**, SO **68398**, amount **1000**. |
| SO edit | `POST /sales/orders/` with `salesorder_id=68398` | Returned the same ID; request preserved the verified required SO and item detail ID **74681**, changed intended `channel_status` to `"Siap Proses"`. No repeat POST. |

HTTP `POST /login` and `POST /inventory/items/all-stocks/` (read-only in effect) were used as disclosed in the draft. The setting for payment type was not a usable number, so the existing sandbox-observed fallback numeric `0` was used, consistent with the app's `paymentType()` helper. All provider writes were at most once; no automatic cleanup, refund or cancellation.

## Observed before/after SO edit

| Field | Before | After |
|---|---|---|
| `channel_status`, detail + filtered sales list | `Belum Bayar` | `Siap Proses` |
| `wms_status` / `is_paid` / `internal_status` | `UNKNOWN` / `null` / `null` | unchanged |
| SO id / source / location / contact / cancel / invoice link | 68398 / INTERNAL / 7 / generic / `null` / 45944 | unchanged |
| Detail id / item / qty / price / SO total | 74681 / 43842 / 1 / 1000 / 1000 | unchanged |
| Invoice 45944 + payment 26 GET | Invoice linked; payment GET contains exactly one association of 1000 with that invoice/SO | Same IDs, invoice/item/amount and known payment association, confirmed again by independent later GET |
| Stock `(on_hand,on_order,available)` | `(3,2,1)` | `(3,2,1)` |

Provider **omitted** `reserved` from the stock response; this is not an observed zero. Initial stock before the create was `(4,2,2)`; converting this new test SO to invoice changed it to `(3,2,1)`. The SO, invoice and payment remain on the test account; their financial/stock effects are **not automatically cleaned up**.

## What this does—and does not—prove

This account accepted one full-payload edit to an invoiced and paid INTERNAL test SO and preserved the **observable** SO fields, stock series, invoice, and known payment association while updating `channel_status` in GET detail/list. **Owner UI confirmation:** a user-provided Jubelio Sales Orders screenshot (`C:\\Users\\USER\\AppData\\Local\\Temp\\pi-clipboard-d560fef3-5a92-4ad0-affb-4519e3885e2d.png`, ephemeral clipboard path; not copied into the repo) shows **SO-000068398: Status Channel = Siap Proses; Status Jubelio = UNKNOWN**. This verifies the post-edit UI display for this one account/SO. It **does not prove** that all custom labels behave alike or that Jubelio has no hidden journal/accounting side effects. The documented `GET /sales/payments/?q=<SO number>` returned `totalCount=0` even when GET payment 26 confirmed the association, so that list filter is **not** a reliable proof against an additional hidden payment; a vendor audit/confirmation or stronger account-scoped financial read is needed before claiming accounting invariance. This is one sandbox/account observation, not authorization for production rollout or automatic retry of an edit.

**Next evidence gate:** UI check is complete. Obtain credible vendor/accounting evidence on edit side effects (especially invoiced orders) before accepting an implementation spec. All later application code and end-to-end tests require separate plan approval.
