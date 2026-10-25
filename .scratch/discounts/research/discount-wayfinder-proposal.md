# Proposal: Discount Design Wayfinder

Status: **complete decision-ticket breakdown explicitly approved and published** through `ask_user_question` by selecting **Setujui dan publikasikan (Recommended)**. The canonical [decision map](../wayfinder/map.md) and its children now live in the configured Local Markdown tracker. This document retains the approved publication proposal; it is not a specification, implementation approval or permission to execute provider requests.

## Destination

Resolve the outstanding product, financial, UX, schema and integration decisions needed for a complete discount specification ready for owner review. Cover persistent SKU markdowns with bulk Excel adjustment, discoverable coupons/manual codes, checkout accounting and safe redemption, Jubelio mapping, and an extensible database design.

Reaching the destination produces a reviewable specification, not approval to implement it. Full-spec approval remains separate from approval to publish this decision map.

## Tracker and publication proposal

Use the already-configured [Local Markdown tracker](../../../docs/agents/issue-tracker.md): `.scratch/discounts/wayfinder/map.md` and `.scratch/discounts/wayfinder/NN-<name>.md`. Do not create a new tracker, publish remotely, or change `.scratch/discounts/index.md` during charting.

After explicit approval, publish all children first, then wire the prerequisite edges. All children start open/unclaimed; charting resolves none. Pre-map owner decisions belong in the map's Notes as standing framing, not fabricated resolved tickets. Closed child answers live in the child; the map's Decisions so far is only an index.

## Confirmed framing — do not ask again

From the existing conversation and this wayfinder charting round:

- Discounts are managed by the website. Jubelio owns source base prices, inventory and sales operations.
- Markdown is a persistent SKU price adjustment for clearance/dead stock, not a mandatory campaign or event.
- A SKU has the **same website price in all branches**.
- Save the **fixed final selling price**. A percentage input calculates that fixed price at confirmation; it is not a continuing percentage rule that follows sync.
- Markdown may combine with at most **one coupon OR one manual promo code**, sharing one slot across goods and shipping.
- Benefit awal: persentase barang dengan plafon opsional, nominal per order, dan subsidi ongkir. Klarifikasi pemilik pada sesi tiket 02 menggantikan catatan targeting sebelumnya: kupon/kode barang bersifat general untuk seluruh barang order pada harga setelah markdown, tanpa targeting produk/kategori/brand.
- Public coupons are selected **directly**, without prior claim.
- Excel import may apply the **valid rows**, with explicit explanations for each invalid row. A 97-valid/3-error file must not be presented as an unqualified 100-row success.
- Website goods discounts must be represented as discounts in Jubelio SO, not silently hidden by reducing only Midtrans money or replacing source prices.
- Database extension architecture is in scope; implementing future cashback/gifts/bundles/tiered benefits is not initial scope.

## Starting evidence

- [Product, admin UX and Jubelio discount research](discounts-coupons-promo-codes.md).
- [Long-term database research proposal](discount-database-design.md).
- [Domain vocabulary](../../../CONTEXT.md#product-pricing-and-promotions).
- [Existing provider sales lifecycle](../../../docs/features/jubelio-sales-orders.md) and [delivery money contract](../../../docs/features/delivery-orders.md).
- Current nonzero-discount guards and gross-only invoice/payment assumptions are verified code facts; provider nonzero-discount behavior is not proven.
- Existing research recommendations are discussion material, not owner-approved defaults. Do not turn suggested quotas, rounding, tax, refund or limit policies into implementation assumptions.

## Proposed decision tickets and dependencies

Names wrap every reference; ordinals below are only the proposed local file ordering.

| Order | Proposed child title | Type | Prerequisites |
| --- | --- | --- | --- |
| 01 | Markdown Base-Price Drift and Restore Policy | grilling | None |
| 02 | Offer Eligibility and Monetary Basis | grilling | None |
| 03 | Redemption Limits, Identity and Reservation Policy | grilling | Offer Eligibility and Monetary Basis |
| 04 | Tax and Shipping Subsidy Accounting | grilling | Offer Eligibility and Monetary Basis |
| 05 | Bulk Price Adjustment and Partial Import Contract | grilling | Markdown Base-Price Drift and Restore Policy |
| 06 | Discount Administration UX and Authorization | prototype | Redemption Limits, Identity and Reservation Policy; Bulk Price Adjustment and Partial Import Contract; Tax and Shipping Subsidy Accounting |
| 07 | Isolated Jubelio Verification Access and Permissions | task (HITL) | None |
| 08 | Jubelio Nonzero-Discount Contract Evidence | research | Isolated Jubelio Verification Access and Permissions; Tax and Shipping Subsidy Accounting |
| 09 | Provider Representation and Settlement Contract | grilling | Jubelio Nonzero-Discount Contract Evidence |
| 10 | Cancellation, Refund and Late-Payment Policy | grilling | Redemption Limits, Identity and Reservation Policy; Tax and Shipping Subsidy Accounting; Provider Representation and Settlement Contract |
| 11 | Schema, Retention and Extension Architecture | grilling | Markdown Base-Price Drift and Restore Policy; Bulk Price Adjustment and Partial Import Contract; Redemption Limits, Identity and Reservation Policy; Provider Representation and Settlement Contract; Cancellation, Refund and Late-Payment Policy |
| 12 | End-to-End Acceptance and Specification Readiness | grilling | Discount Administration UX and Authorization; Schema, Retention and Extension Architecture |

### Markdown Base-Price Drift and Restore Policy

**Question:** What should happen to a persistent fixed SKU markdown when Jubelio source price changes, the relationship is no longer a valid discount, or an admin restores base pricing?

Resolve: base below/equal target; truthful compare-at display; review/checkout availability versus automatic source fallback; optional approved price floor/zero-price exclusions; meaning of restore; source/current-version conflicts and treatment of already-created orders. Example: source Rp300,000, fixed markdown Rp150,000, later source Rp120,000.

Do not reconsider global price scope or fixed-versus-dynamic storage. Output: a small scenario table of source/markdown changes, customer display/checkout and required admin action.

### Offer Eligibility and Monetary Basis

**Pertanyaan:** Dasar barang/ongkir, minimum belanja, dan aturan perhitungan apa yang berlaku untuk offer general awal?

Sudah dikonfirmasi: seluruh barang order memakai harga setelah markdown; tanpa targeting produk/kategori/brand atau include/exclude. Sepatu Rp150.000 + baju Rp300.000, diskon 10% cap Rp20.000 → net barang Rp430.000 sebelum pajak/ongkir/fee.

Keputusan tiket 02 kini resolved setelah konfirmasi pemilik: minimum memakai subtotal seluruh barang setelah markdown; nominal dibatasi subtotal; subsidi ongkir delivery sebesar min(ongkir, plafon); pembulatan turun dan alokasi proporsional deterministik; invalid/benefit nol ditolak tanpa memakai jatah; checkout total nol ditunda; tanggal opsional dengan waktu server/input WIB, mulai inklusif/akhir eksklusif; tanpa conditions tambahan. Plafon persentase opsional: subtotal Rp450.000, 10% tanpa cap → potongan Rp45.000/net barang Rp405.000. Detail authoritative di [jawaban tiket 02](../wayfinder/02-offer-eligibility-and-money-basis.md#answer--keputusan-final-disetujui).

Do not change the one-offer slot or direct-selection/no-claim decisions. Output: independent worked money/eligibility examples and the initial supported rule set, without settling tax law or provider field semantics.

### Redemption Limits, Identity and Reservation Policy

**Question:** What configurable limits and identity checks govern coupon/manual-code use, and when is capacity held, consumed or released?

Resolve: total/personal counts and subsidy budgets; mandatory/default values versus optional limits; verified email/phone scope and friction; allowed initial audience/new-customer/code-binding rules; repeat windows/code subquotas if needed now; existing-order versus payment-attempt failure; no-benefit use; revision/rename/codes retaining history; rate-limit/challenge policy and manual-review escalation. Distinguish per account from per natural person.

Output: usage/capacity lifecycle and approved initial anti-abuse controls. Detailed refund restoration and late-payment dispositions are owned by Cancellation, Refund and Late-Payment Policy, not guessed here.

### Tax and Shipping Subsidy Accounting

**Question:** What money and tax policy connects source goods, markdowns, coupons, shipping cost/subsidy, customer charge and merchant funding?

Resolve: whether current website/provider tax separation is retained; taxable goods after reductions; shipping taxable basis and who funds subsidy; provider cost versus customer net shipping; tax-inclusive/exclusive display; snapshot totals for Midtrans/repayment; finance confirmation where required. Example: goods Rp150,000, shipping Rp30,000 and subsidy Rp20,000.

Output: an approved monetary component/tax/funding contract. Do not assume a shipping subsidy belongs in Jubelio `disc_amount` or that it automatically reduces the tax base. This answer scopes the meaningful sandbox verification cases.

### Bulk Price Adjustment and Partial Import Contract

**Question:** What exact manual/bulk/Excel experience safely applies the valid subset and reports every failed row?

Resolve: final template/version and numeric/text formats; SKU/variant selection and optional percentage shortcut; explicit restore input; unknown/duplicate SKU handling; file-fatal versus row errors; row/file limits and foreground/background threshold; accepted-row review; source/current-price conflicts discovered at apply time; retries of failed rows without reapplying successes; accurate partial status, audit and downloadable error report.

Fixed global prices and applying valid rows are already decided. Output: example workbook rows and 100-row/97-success/3-error walkthroughs, including a concurrent admin price change. Do not promise unbounded atomic bulk publication.

### Discount Administration UX and Authorization

**Question:** How should authorized admins navigate price adjustments, public coupons/manual codes and usage evidence, and what must the review/confirmation screens disclose?

Resolve through **Markdown wireframes only**: navigation under Products/Discounts; SKU before/after table; bulk progress/error/retry; coupon/code forms and revisions; current/shared slot feedback; reserved versus used/budget reporting; admin permissions/authorization ceiling for global prices, creating offers, changing budgets and managing codes; sensitive-code visibility and audit disclosures.

Output: a bounded reviewable Markdown wireframe and action/permission matrix. No executable prototype, app edits, branch creation, commit or extra subagent is authorized by this ticket. Load prototype/frontend-design guidance when working it, subject to project gates.

### Isolated Jubelio Verification Access and Permissions

**Question:** What designated isolated test account/access and separately approved request scope can safely provide the missing provider money evidence?

The human supplies business/account authorization; the agent verifies available credentials privately rather than asking for secrets in chat. Establish whether the owner permits zero/nonzero-discount disposable SOs, invoice conversion/payment, eligible pre-invoice cancellation and any full-payload mirror verification. Record exact allowed actions/limits/protected fixtures and cleanup constraints. If the owner declines business writes, record the alternative evidence path and the launch blocker; do not pretend an inaccessible sandbox is verified.

Output: access/permission facts and safeguards, not a general license to POST. Login authorization alone does not authorize SO/invoice/payment writes. Until a bounded actual request protocol is explicitly authorized, provider work remains documentation/read-only.

### Jubelio Nonzero-Discount Contract Evidence

**Question:** What independently verified provider behavior establishes nonzero goods discounts, shipping representation and preservation through invoice/payment?

Use existing research; investigate only gaps: `disc` versus `disc_amount` authority, nominal per-unit versus total-line for quantity > 1, `total_disc` versus `add_disc`, capped/fixed allocations, writable shipping/funding fields for INTERNAL source, SO GET → invoice GET → payment GET and monetary preservation during safe cancel/mirror edit. Read-only provider/support evidence can narrow the question before authorized sandbox writes.

Output: sanitized evidence and explicit unknowns, linked as an asset. Fact research is not owner approval of an accounting option. Use direct execution unless separately delegated; no automatic subagents. Only requests explicitly authorized by the access ticket's actual protocol may be sent; no existing-order edits, production writes or blind retries after ambiguous results. If required evidence remains unavailable, this child stays blocked/open rather than claiming readiness.

### Provider Representation and Settlement Contract

**Question:** Given provider evidence and the chosen finance policy, which exact discount fields/amounts must SO, invoice, Jubelio payment, mirrors and local snapshots carry?

Resolve: nominal-line allocations versus verified header discount; preserving source unit prices and separate website components; confirmed expected provider net payable; goods-only versus expanded verified shipping ledger; strict per-line/aggregate checks, provider payload versioning and ambiguous/mismatch disposition.

Output: a mapping and verification contract with the worked examples. Do not select zero-discount reduced-unit-price reporting or gross provider payment as a workaround contrary to the owner's requirement. Do not silently remove existing safety guards.

### Cancellation, Refund and Late-Payment Policy

**Question:** How do safe unpaid cancellation, customer/merchant cancellation, partial/full refunds, threshold-sensitive returns and late payment affect capacity, customer benefit, provider handling and customer communication?

Resolve: release only after authoritative terminal evidence; consumed usage/budget restoration or audited replacement; net line/shipping refunds without cashing out subsidy; partial return reducing threshold eligibility; payment after released/canceled order; paid-but-provider-blocked handling and review ownership; scope when automated refund tooling does not exist.

Output: explicit scenario/state/money table. Separate current-feature requirements from any new refund/return subsystem; do not quietly add full automated refund infrastructure if a constrained audited workflow is sufficient for the destination.

### Schema, Retention and Extension Architecture

**Question:** What final schema and transaction/snapshot contracts express the now-approved behavior without overgeneralizing future mechanisms?

Resolve: markdown current/revisions and partial-import rows; offer identity/version/benefit/condition/target associations; code/offer ownership; account/optional stronger-identity usage; reservation/events/allocation constraints; idempotency; immutable local/provider money; indexes and bounded locking; legacy voucher counters with missing history; current client/order cascade retention; seed synchronization; compatible rollout/deployment; typed/versioned extension parameters and future ledger requirements.

Output: final logical schema/constraint/compatibility decision and concrete use-case records. Proposed table names/count in research are not automatically approved. No migration or application implementation in this ticket.

### End-to-End Acceptance and Specification Readiness

**Question:** Which observable acceptance criteria, test seams and provider release gates are required for a complete reviewable spec, and is any owner-owned decision still unresolved?

Resolve: markdown catalog/detail/cart consistency; valid-row Excel outcomes/retries; direct coupon/manual-code replacement; one slot; independent capped/fixed/shipping examples; real-DB quota/budget/concurrency and replay; immutable order/provider money; cancellations/refunds; authorization/audit; legacy migration proof; provider sandbox evidence and rollout safeguards.

Output: linked acceptance matrix and a precise complete-spec outline. After decisions are resolved, draft the full specification for **separate owner approval**; do not mark Ready or publish implementation tickets on the strength of this map's approval.

## Initial frontier after publication

The first open/unblocked/unclaimed child would be **Markdown Base-Price Drift and Restore Policy**. **Offer Eligibility and Monetary Basis** and **Isolated Jubelio Verification Access and Permissions** are also initially unblocked, but one session works no more than one HITL decision child unless the wayfinder policy is explicitly revised. Map charting will stop after publication and will not resolve these children.

## Not yet specified

- Findings may reveal additional finance/provider evidence or a narrowly scoped operator workflow before safe discount use; ticket the concrete gap when it can be phrased precisely.
- Exact rollout/read-projection/large-job strategies will sharpen after the money, import and retention choices. Do not pre-slice them into implementation tasks now.
- Additional compliance/identity-retention dependencies may surface if verified-phone or cross-account limits are selected.

These are in-scope uncertainties, not a license to choose policies or build an unapproved subsystem.

## Out of scope

- Application/schema/seed implementation, migration execution, test execution as delivery work, implementation tickets or Ready transitions during charting.
- Branch-specific prices, dynamic persistent percentage markdowns, coupon wallets/claims, multiple coupon/code stacking and multi-benefit initial offers.
- Implementing cashback/points, gift/bundle/BOGO/tiered/subscription benefits, other currencies or new channels. The spec may document extension seams without building them.
- Subagents unless explicitly authorized for this effort; automatic research forks or commits.
- Auth/provider writes without separate exact request approval; existing-order mutations, production experiments, blind retries and provider source impersonation.
- Commit, push, SSH, remote publication or deployment.

## Approval recorded

The owner explicitly approved the **complete destination, confirmed framing, twelve decision questions, types, dependency graph, tracker location and boundaries above** through `ask_user_question` by selecting **Setujui dan publikasikan (Recommended)**. The map and all twelve children were then published; dependencies were wired in a second pass. All children remain open/unclaimed and charting resolves none. Publication approval is not spec approval, permission to work a child, delegation permission or provider-write authorization.
