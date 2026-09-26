# Parkir investigasi Status Jubelio / WMS

Parent: [Cermin status website di Status Channel SO pickup Internal](../map.md)
Type: research
Status: deferred (owner decision: focus on `channel_status`; not a blocker for 02/03)
Blocked by: none

## Previously targeted outcome

Make vendor UI **Status Jubelio** show **Belum Dibayar** after a new INTERNAL pickup SO, then **Siap Proses** only after Midtrans settlement and verified Jubelio invoice/payment. This is **not** the active channel-marker goal; the two vendor UI columns remain separate.

## Evidence and unresolved vendor facts

- [Initial research](../../../plan/research/jubelio-wms-status-unknown.md) and [redacted SO comparisons](../observations-2026-09-26.md): INTERNAL SOs remained `wms_status=UNKNOWN`/`is_paid=null` after verified invoice/payment. The provided `PENDING`/`PAID` comparison SOs came from SHOPEE, not INTERNAL.
- [Candidate API research](02-pastikan-asal-status-ui-dan-transisi-pickup.md) and [controlled WMS/channel trial](../combined-test-results-2026-09-26.md): `POST /wms/sales/ready-to-process` is documented for empty-stock or failed-pick recovery; empty-stock list returned zero, failed-pick GET 404, so no eligible test-owned SO and **no WMS POST**. A marker in `channel_status` did not change `wms_status`.
- `set-as-paid` is documented to mark an SO paid, but its WMS/UI/stock/accounting effect after a verified invoice payment is not proven here. The captured one-shot trace for SO 68395 did not establish whether a previous optional request was sent. **Never retry on 68395 without an authoritative vendor audit.**

## Reopen only if the owner reprioritizes WMS

Get the official UI mapping, source-1 pickup eligibility, side effects of paid/WMS transitions, and a safe isolated fixture before a new write experiment. Require a separately reviewed plan and permission for each scope; do not use a customer or previously ambiguous SO. This parked issue does not grant remote access, POST, implementation, or changes to local pickup rules.
