# Research: GET lookup after an unknown Jubelio Shipment booking

## Scope and conclusion

Owner requested research during admin delivery workflow decision ticket 05. Investigate whether a GET can find a shipment after a create timeout, and whether an empty result permits another create. Research only; no new operational behavior is approved.

**Conclusion:** available evidence supports GET detail when the AWB or Shipment ID is already known. It does not establish lookup by the original request reference when both identities are unknown, nor an authoritative negative result that guarantees the original operation cannot later create a shipment. Do not implement `not found -> create again` on this evidence.

This is a documentation gap, not proof that Jubelio has no such endpoint. Obtain a current Shipment contract or provider confirmation before deciding an extension.

## Sources and findings

1. Repository [Shipment v1.8 contract transcription](../../../docs/jubelio-api/shipment-v1.8.md#base-urls-authentication-and-endpoint-map), based on a vendor-provided 21-page PDF, documents `GET /shipments/awb/{awb}`. Its [AWB section](../../../docs/jubelio-api/shipment-v1.8.md#get-shipmentsawbawb) states lookup uses the AWB returned by create. The extracted vendor text at `.tmp/jubelio-shipment-v1.8.txt`, section 3.3, explicitly says the AWB is obtained during Generate AWB. The original PDF linked by the transcription was not present in this checkout; the extraction and transcription were reviewed, not a newly opened original PDF.
2. The same [create section](../../../docs/jubelio-api/shipment-v1.8.md#post-shipmentscreate) documents `ref_no`, but not its use as an idempotency key or a lookup endpoint. Historical live verification notes at the bottom show `ref_no` round-tripping on known-AWB GET, not lookup by reference or duplicate-create safety. Those notes were not repeated as live tests in this research.
3. Current publisher-distributed [Jubelio WordPress plugin API source](https://plugins.svn.wordpress.org/jubelio-shipment/trunk/includes/classes/class-jubelioshipment-api.php), fetched read-only, contains `get_awb_details($shipment_id)` using GET `/shipments/{shipment_id}`. It still requires a known Shipment ID. No shipment lookup by `ref_no` was found in this API class. Plugin code is implementation evidence, not a supported endpoint contract for this marketplace tenant. The mutable trunk source was saved locally at `.tmp/jubelio-shipment-api-research.php`; relevant methods are lines 757–791.
4. Context7 resolution `/websites/jubelio` and the query for Shipment reference lookup returned [Omnichannel API documentation](https://docs.jubelio.com/dist.yaml), including `/sales/shipments/{shipment_header_id}`. These are not evidence for the separate Shipment host. [The repository contract](../../../docs/jubelio-api/shipment-v1.8.md) explicitly separates these APIs and credentials.
5. Existing [admin gateway](../../../apps/admin/src/lib/jubelio-shipment-client.ts) lines 275–318 implements `getAwb(awb)` only. A 404 raises `SHIPMENT_AWB_UNKNOWN`, not permission to create. The gateway can refresh credentials via a token POST; it was not invoked during research.
6. [Fulfillment service](../../../apps/admin/src/lib/shipment-fulfillment.ts) uses `ref_no = orderId` for correlation, blocks repeated booking in dispatched/unknown states, and records ambiguous outcomes. Correlation is not a proven provider idempotency guarantee.
7. Existing [follow-up policy](../../../docs/features/delivery-follow-up.md#booking-ambiguity-and-proof-approved-release) explicitly excludes timeout, 404, elapsed time, empty dashboard results and `ref_no` from absence proof. Stable `booking_unknown` requires explicit confirmation that no booking exists and the original operation is closed; release does not create a shipment. Active `booking_dispatched` remains held.

## Practical interpretation

| Situation | What current evidence supports | What it does not support |
|---|---|---|
| AWB already persisted | GET the known AWB and verify external identity | Creating another shipment because tracking lookup failed |
| Shipment ID known but AWB missing | Plugin shows an ID-based detail route; tenant contract/support must be confirmed | Assuming this route is implemented or supported by the marketplace |
| Timeout before either identity is recorded | Current proof-based operational escalation | A supported reference-only search button, based on available documents |
| Matching shipment found through a future confirmed lookup | Evidence of an existing shipment; do not rebook | Automatic adoption into the local ledger without a separately approved identity/recovery design |
| Future lookup returns empty/404 | No matching result obtained at that moment | Proof that the initial operation is closed and can never create a shipment |

Example: create attempt 1 times out. A later search returns empty while attempt 1 is still processing. Attempt 2 is then created, followed by successful completion of attempt 1. Two shipments can result. This is a risk scenario, not a claim that this timing was observed in Jubelio.

## Questions to send to Jubelio

- Is there a supported Shipment GET lookup by caller-supplied `ref_no` or request/operation ID when AWB and Shipment ID are unknown? Provide method, path, authentication, tenant scope, response schema and current documentation.
- Is `ref_no` unique or idempotent? What happens if the same reference is submitted concurrently or after a timeout, including whether a second shipment or charge can occur?
- Can lookup expose the original operation as pending versus finally closed without a shipment? Does a documented terminal negative guarantee that no later creation can occur?
- Can an empty/404 result occur during processing or before the shipment becomes searchable? What consistency guarantees exist?
- What is the supported recovery procedure if lookup finds the shipment but the original create response was lost?

## Implications for decision ticket 05

Keep GET discovery and shipment adoption as unresolved potential scope extensions. Do not resolve the proof-release presentation question on the assumption that GET removes the need for proof. Existing manual release remains valid under current rules; the owner still needs to choose its acknowledgement presentation if ticket 05 continues unchanged.

## Verification and limits

Read repository documentation, vendor PDF text extraction and relevant application code; queried Context7; searched public sources and fetched the publisher-distributed plugin API class. No authenticated Shipment GET, token/authentication POST, booking POST, cancellation, provider mutation, application edit, test, build, lint, delegation, commit, remote operation or deployment was performed. No unsupported endpoint paths were probed. Research does not verify undocumented tenant-specific APIs or establish current production behavior.
