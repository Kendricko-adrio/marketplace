# Research: product markdowns, coupons, and manual promo codes

Research date: 2026-10-13 (local workspace clock).
Status: research and recommendations only; **not an approved implementation spec**.

## Klarifikasi scope fase awal — keputusan pemilik

Kupon/kode diskon barang bersifat **general untuk seluruh barang dalam order**, menggunakan harga setelah markdown. Tidak ada targeting produk/kategori/brand maupun include/exclude pada fase ini. Catatan lama yang menyebut targeting sebagai kebutuhan disetujui dikoreksi oleh klarifikasi ini; pembahasan vendor/extension targeting tetap hanya referensi future-only. Benefit awal tetap persentase dengan plafon opsional, nominal per order, dan subsidi ongkir; satu slot kupon/kode tetap berlaku.

Contoh terkonfirmasi: sepatu Rp150.000 + baju Rp300.000 = Rp450.000; 10% = Rp45.000, dibatasi Rp20.000 → net barang Rp430.000 sebelum pajak/ongkir/fee. Tanpa cap, contoh yang sama mendapat diskon Rp45.000 dan net barang Rp405.000. [Jawaban final tiket 02](../../.scratch/discounts/issues/02-offer-eligibility-and-money-basis.md#answer--keputusan-final-disetujui) telah dikonfirmasi pemilik: minimum memakai subtotal barang setelah markdown; nominal maksimal subtotal; subsidi ongkir delivery min(ongkir, plafon), sisa hangus; pembulatan turun/alokasi proporsional largest remainder dengan tie ID stabil; invalid/benefit nol ditolak tanpa memakai jatah; total pembayaran nol ditolak (flow gratis ditunda); tanggal opsional, WIB/waktu server, mulai inklusif/akhir eksklusif; tanpa conditions tambahan. Keputusan ini menggantikan usulan berbeda di bagian historis; pajak/funding, kuota/identitas, dan provider tetap belum diselesaikan oleh tiket ini.

## 1. Executive recommendation

**Updated after user feedback:** all three user-facing concepts should use one pricing/discount engine, not just coupons and manual codes. They execute at different stages; they do not need identical eligibility or activation flows.

Keep the three user-facing concepts, but do not build three independent discount engines:

1. **Product markdown / crossed-out price**: a website-managed price adjustment attached to variants, visible before checkout; used for clearance/dead stock and not inherently a campaign.
2. **Discoverable coupon**: a promotion shown to eligible customers and selected at checkout; claiming into an account wallet is optional scope.
3. **Manual promo code**: a promotion activated by entering a code, normally absent from the public coupon picker.

Separate **benefit** (percentage, fixed amount, shipping subsidy), **target** (goods/order/shipping), **eligibility**, and **activation/discovery**. A manual code can give exactly the same 10%-up-to-Rp20,000 benefit as a discoverable coupon. This separation is supported by Shopee's visible/hidden voucher settings and Stripe's coupon-to-promotion-code model. It is a recommendation for this project, not a proposal to adopt Stripe. [S1, S6]

**User-confirmed product direction:** promotions are maintained on this website; Jubelio supplies base prices and manages stock/sales. Website-calculated goods discounts must be represented as discounts in Jubelio Sales Orders, not only hidden in reduced website totals. Pemilik memilih persentase dengan plafon, nominal per order, dan subsidi ongkir. Klarifikasi terbaru: diskon barang general untuk seluruh barang order; targeting produk/kategori/brand bukan scope fase awal. The user clarified that product markdowns are price adjustments for older/slow-moving stock, not campaign-first promotions. They remain in the original requested scope; mandatory campaign names and event periods are not the intended model. Complex tiers, bundles, gifts, cashback, per-unit coupons and payment-method promotions are not part of the selected initial set.

This feedback settles product direction, **not approval of a complete implementation spec**. Detailed limits, accounting semantics and verification gates remain open. Subsequent user feedback explicitly permits product markdown plus one coupon/code, but prohibits stacking multiple coupons/codes, with one shared slot across goods and shipping. Other controls below remain proposed, not implemented.

No system can guarantee zero abuse, especially “one natural person” without strong identity checks. The practical goal is to enforce financial invariants, prevent repeat use by known identities, detect suspicious behavior, and cap maximum loss. [S7; project recommendation]

## 2. Verified project baseline

Code is the authority where older docs disagree. References below describe the inspected checkout, not a live production audit.

| Verified fact | Evidence | Consequence |
| --- | --- | --- |
| Crossed-out price already derives from product RRP versus variant net price. There is no campaign scheduling/redemption behind this display. | [Pricing model](../../docs/features/pricing-model.md); [detail display](../../apps/store/src/app/products/[id]/page.tsx#L178) | Reuse the display concept, but website price adjustments need authoritative effective pricing everywhere. |
| Jubelio sync overwrites product `basePrice` and variant `price` on conflict. | [sync L795–874](../../packages/db/src/jubelio-sync.ts#L795) | Direct source-price edits are not durable website markdowns; the next sync can erase them. |
| Existing vouchers have `percentage`, `fixed`, `shipping`, minimum purchase, global quota, usage counter and active dates. No per-customer redemption ledger appears in this model. | [marketing schema L11–28](../../packages/db/src/schema/marketing.ts#L11) | This is a starting point, not a safe end-to-end promotion system. |
| Validation is unauthenticated, receives browser subtotal, and only previews discounts. Minimum-spend checking uses a truthiness condition; omitted/zero subtotal bypasses that check. The route contains no explicit rate limiter and uses `console.error`, not the app logger. | [validate route L7–96](../../apps/store/src/app/api/vouchers/validate/route.ts#L7) | Do not treat its response as checkout authorization. These are preview gaps, not evidence that customers currently obtain free goods. Edge-level protection was not audited. |
| The helper treats shipping as a flat amount, without capping it against actual shipping; fixed discounts are not capped against eligible goods here. | [helper L9–25](../../apps/store/src/lib/vouchers.ts#L9) | Replace preview semantics before exposing real redemption. Pickup must never turn a shipping voucher into a goods discount. |
| Checkout reads owned cart and DB variant prices; pickup sends `discount: 0`. No voucher input/redemption is wired into checkout. | [place-order L223](../../apps/store/src/app/api/checkout/place-order/route.ts#L223), [L533–540](../../apps/store/src/app/api/checkout/place-order/route.ts#L533); [voucher feature](../../docs/features/vouchers.md) | New redemption must be integrated into order creation and payment, not just the validator. |
| Delivery is implemented: placement re-quotes and requires approval of changed money; its immutable snapshot carries shipping and pricing. | [place-order L410–500](../../apps/store/src/app/api/checkout/place-order/route.ts#L410); [delivery orders](../../docs/features/delivery-orders.md) | Shipping subsidies can target actual delivery quotes. Older Sales Order docs saying delivery is inactive are stale on this point. |
| Current delivery PPN includes quoted shipping in the taxable base; pickup taxes goods after goods discount. | [order-pricing L72–100](../../apps/store/src/lib/order-pricing.ts#L72); [delivery money example](../../docs/features/delivery-orders.md#two-ledgers-and-payment) | Do not assume shipping is always outside PPN. Discount tax treatment needs accounting approval. |
| Jubelio SO currently receives variant prices with zero discount/tax; the gateway explicitly rejects nonzero item discounts/tax. Invoice validation compares against local pre-PPN goods subtotal, and Jubelio payment uses that subtotal. | [place-order L574–595](../../apps/store/src/app/api/checkout/place-order/route.ts#L574); [gateway L428–436](../../apps/store/src/lib/jubelio-sales-client.ts#L428); [invoice validation L754–762](../../apps/store/src/lib/jubelio-sales-lifecycle.ts#L754); [payment amount L827](../../apps/store/src/lib/jubelio-sales-lifecycle.ts#L827) | A goods voucher is a cross-ledger accounting change. Updating only website/Midtrans totals would leave Jubelio unaware of the reduction. |
| Marketing admin is a placeholder. RBAC module-scope constraint does not currently include a discounts/marketing module. | [marketing page](../../apps/admin/src/app/admin/marketing/page.tsx); [RBAC L94–103](../../packages/db/src/schema/rbac.ts#L94) | Secure admin CRUD requires explicit permission design, not only a new sidebar link. |
| Store clients have email verification, but phone is plain text with no phone-verification field or uniqueness in the inspected schema. | [client schema L10–25](../../packages/db/src/schema/auth.ts#L10); [store auth L109–115](../../apps/store/src/lib/auth.ts#L109) | Contact phone is not a verified identity. Phone-based anti-multi-account controls need a separately approved verification flow. |

No unit/E2E tests, provider calls, infrastructure operations, or runtime exploit attempts were performed for this research.

## 3. What first-party marketplace documentation supports

### Shopee Indonesia

The seller guide documents fixed nominal discounts, percentages with a maximum discount, and cashback coins. It also documents minimum purchase, total usage quota, adjustable maximum uses per buyer (up to five on that platform), one voucher per order, product targeting, and public versus hidden display. Buyers can manually enter a code without claiming it first. [S1]

**Applicable lesson:** claim/discovery is not the same as redemption. The project can offer public selectable coupons and hidden manual codes using shared benefit/limit rules. Shopee's numeric limits are platform-specific, not mandatory defaults for Okcir.

### Shopify

Official types include percentage/fixed discounts, Buy X Get Y, and free shipping; advanced tiers and multi-benefit promotions need additional solutions. Its combination model separates product, order and shipping classes, explicitly controls combinations, applies product discounts before order discounts, and allows only one shipping discount in a combination. Its FAQ describes holding code usage during submitted-but-unpaid checkout and releasing the hold after payment failure. [S2–S5]

**Applicable lesson:** model discount classes, deliberate stacking, and payment-aware reservation. Do not copy Shopify's entire multiple-code feature into the first release.

### WooCommerce

The core distinguishes fixed-cart from fixed-product discounts. It documents product/category restrictions, sale-item exclusions, individual-use-only, coupon-wide usage limits, per-user limits, and maximum discounted item quantities. Goods coupons apply before goods tax and do not reduce shipping except through a free-shipping mechanism. Its minimum-spend tax basis depends on display configuration. [S8]

**Applicable lesson:** define whether Rp20,000 means once per order or once per unit, and define the threshold basis explicitly. Vendors do not all use identical threshold/tax semantics.

### Lazada and Tokopedia

Lazada's general voucher terms explicitly address multiple accounts/multiple checkouts associated with the same customer/group, default single use unless otherwise stated, stacking restrictions and non-cash-convertibility. Tokopedia's Promo section limits participation to one account per user and identifies matching account/payment identity as grounds to deny benefits; its shipping-promo terms distinguish customer refund from shipping subsidy. [S9, S10]

**Applicable lesson:** account limits alone are not sufficient against multi-account abuse; publish anti-abuse terms and avoid refunding merchant subsidies as customer cash. These general terms are not proof of every current campaign's behavior, nor a reason to copy broad cancellation powers into our policy unchanged.

### OWASP

OWASP API6 describes abuse of sensitive business flows through automation, including reservation hoarding and automated referral rewards. It recommends business-level analysis plus engineering protections such as human challenges and behavioral detection. [S7]

**Applicable lesson:** a valid login and a CAPTCHA are not substitutes for atomic quota/budget enforcement.

## 4. Coupon benefit catalog and project fit

The following are source-backed patterns or explicitly marked project extensions. Audience/channel restrictions are eligibility, not separate money formulas. Scope awal hanya benefit persentase/nominal per order/subsidi ongkir, dengan diskon barang general untuk seluruh barang order. Targeting produk/kategori/brand dan baris lanjutan hanya referensi future-only.

| Benefit/pattern | Short example | Evidence and project fit |
| --- | --- | --- |
| Capped percentage | 10%, maximum Rp20,000, minimum eligible spend Rp100,000 | Shopee percentage/max/min; suitable initial benefit. [S1] |
| Fixed amount per order | Rp25,000 off eligible goods, minimum Rp200,000 | Shopee nominal and WooCommerce fixed-cart; suitable initial benefit. [S1, S8] |
| Full/capped shipping subsidy | Shipping Rp30,000; subsidy up to Rp20,000; customer pays Rp10,000 | Free shipping supported by Shopify; a capped partial subsidy is our proposed extension. Only delivery, selected services/areas, never pickup. [S2] |
| Product/variant/category/brand-specific — future-only | 15% untuk sepatu tertentu, maksimal Rp30.000 | Referensi vendor, bukan kebutuhan fase awal; kupon/kode barang awal berlaku general. [S1, S2, S8] |
| Fixed discount per eligible unit | Rp10,000 per pair, maximum two pairs | WooCommerce fixed-product and item limits. Higher subsidy exposure than per-order; later option or tightly capped scope. [S8] |
| Buy X Get Y / BOGO | Buy two eligible items, get the cheapest eligible third at 50% off | Shopify Buy X Get Y. Needs item selection, gift stock, quantity caps and refund rules; later. [S3] |
| Tiered spend/quantity | Spend Rp200,000 → Rp20,000; Rp400,000 → Rp50,000 | Shopify lists advanced tiers; exact thresholds and highest-tier-only rule are our proposal. Later. [S2] |
| Bundle price | Buy selected shoes + socks for Rp350,000 | Project extension of multi-item promotion logic; no claim that all researched vendors offer this exact native feature. Requires line allocation and returns policy; later. |
| Gift with purchase | Spend Rp500,000, receive one stocked accessory | Shopify free Y with purchase threshold. Gift is a real SKU, not imaginary stock; later. [S3] |
| Cashback/points | Earn 5%, maximum Rp20,000 in non-withdrawable store credit after completion | Shopee cashback coins. Not an immediate checkout discount. Needs credit ledger, delayed issuance, expiry, reversals and refund support; later. [S1] |
| Multiple benefits in one coupon | 10% off goods plus shipping subsidy | Shopify documents multi-benefit discounts via additional solutions. Our first release should avoid this complexity or explicitly account for both components. [S2] |

Eligible-customer examples: first paid order, returning buyers, selected client IDs, future loyalty segments. Eligible-channel examples: website, campaign/referral source, selected branch, fulfillment method. Customer targeting is source-backed [S1, S3, S6]; the exact Okcir segment definitions need a business decision.

**Payment-method promotions should wait.** Current checkout freezes money before the customer chooses a method on hosted Midtrans Snap; `paymentMethod` starts null. A browser declaration of “I will use bank X” is not payment proof. A payment-specific discount requires enforced provider selection and a safe money/repricing lifecycle, or a separately designed post-payment reward. [place-order L646](../../apps/store/src/app/api/checkout/place-order/route.ts#L646); [API payment notes](../../docs/api-reference.md)

## 5. Recommended product-markdown behavior

Website ownership of markdowns and coupon/code promotions is user-confirmed. The user explicitly rejected the earlier campaign-first markdown framing: older footwear can be marked down to clear dead stock without a marketing event. Vocabulary is captured in [CONTEXT.md](../../CONTEXT.md#product-pricing-and-promotions). Detailed pricing/lifecycle choices below remain recommendations, not an approved spec.

- Preserve Jubelio source prices. Store website **markdown adjustments** separately; calculate an **effective unit price** through one shared pricing authority used by catalog, filtering/sorting, product detail, cart, quote and order creation.
- Resolve adjustments per variant; selecting an expensive variant must not receive a price derived from the cheapest card variant. Admin can select a product and apply a change to all variants, or select particular variants.
- For Rp300,000 → Rp150,000, the checkout line must charge Rp150,000; the display reduction is 50%. A badge alone is not implementation.
- Do not inflate a compare-at reference to manufacture a percentage. Product `basePrice` is documented RRP, not verified historic selling price. If the reference is RRP, label it clearly; “previous selling price” needs price-history evidence.
- User-confirmed during wayfinder charting: store a fixed final selling price, the same for all branches. Percentage input is a convenience that calculates the fixed target at preview/confirmation, not a persistent percentage rule. Base-price synchronization does not automatically recalculate the stored target; invalid target/base relationships still need a handling decision.
- Recommend one current adjustment per variant in the approved price scope, with replacements presented as current → proposed price and recorded in history. A further reduction replaces the current markdown; it is not another stacked product markdown.
- Recommend no mandatory campaign name, start/end period or automatic reversion. An adjustment persists until an authorized change/removal; “Restore base price” is an explicit action. Scheduling/time-limited sale campaigns can be a separate future feature, not a prerequisite for clearance.
- Revalidate an absolute target against current source price and an approved merchant floor when source prices change. Preserve the stored adjustment/history; surface changed/invalid bases for review. The exact handling of an invalid effective price is still an open safety decision, not permission to sell an unintended loss-making or falsely discounted price.
- Coupon redemption quotas/budgets/expiry are separate from ordinary markdown pricing. Do not automatically impose one-use-per-customer or promotional-unit quotas on clearance markdowns. If quantity/margin safeguards are wanted, approve them independently. Ordinary inventory still controls availability.
- Already-created orders retain their approved money snapshots when a markdown is changed/removed; new checkouts use the current adjustment.

**Key dependency:** the user requires discounts to appear in Jubelio SO discount fields. Merely reducing the SO unit price and retaining zero discount fields is therefore not the target design. Prefer preserving the snapshotted source unit price and mapping website markdown/coupon allocations into explicit nominal line discounts, subject to the verification in §10. Sending actual nonzero discount fields is currently blocked locally; do not bypass that guard until the SO → invoice → payment → cancellation contract is proven.

## 6. Money, eligibility and stacking recommendations

### Bases and caps

For the initial design, propose:

- `E` = jumlah seluruh barang dalam order pada harga setelah markdown, sebelum kupon, PPN, ongkir, dan fee. Tidak ada excluded line berdasarkan produk/kategori/brand pada fase awal. Minimum belanja memakai `E` telah disetujui pemilik.
- Diskon persentase barang: `Dg = min(floor(E × rate / 100), E, cap jika diisi)`. Plafon persentase opsional dan diterapkan sekali per order; jika diisi harus positif.
- Fixed per-order goods discount: `Dg = min(fixedAmount, capIfConfigured, E)`.
- Shipping discount: `Ds = min(actualEligibleShippingCharge, shippingCap)`. For percentage shipping, also cap `shipping × rate / 100`.
- Goods and shipping discounts never produce negative bases; unused voucher value is not cash, credit or a discount on another component.
- All percentages and money must be bounded, finite and nonnegative; initial ordinary discounts should require `0 < rate <= 100`, positive fixed values, integer nonnegative coupon quotas, and `start < end` for time-bounded coupon/code promotions. Markdown persisten tidak wajib tanggal akhir. Kupon/kode juga boleh tanpa batas tanggal; jika keduanya diisi, mulai < akhir, mulai inklusif/akhir eksklusif, waktu server/input WIB. Persentase 100% diperbolehkan, tetapi checkout total final Rp0 ditolak pada fase ini; flow gratis ditunda.
- Use deterministic exact-money arithmetic, not floating-point money. Round coupon benefits downward to whole Rupiah, allocate remainders deterministically, then apply approved PPN rules once. Pembulatan turun dan alokasi largest remainder dengan tie ID stabil telah disetujui di tiket 02; helper saat ini memakai integer-scaled money, tetapi bukan bukti engine diskon baru sudah diimplementasikan.
- Customer total = net goods + net customer shipping + approved fees + approved PPN. **PPN base is a separate accounting decision**, especially for merchant-funded shipping subsidies. Existing delivery taxes shipping; do not change that implicitly.

Examples (before PPN/fees):

| Input/action | Expected proposed outcome |
| --- | --- |
| Eligible subtotal Rp150,000, 10% capped at Rp20,000 | Rp15,000 goods discount. |
| Eligible subtotal Rp300,000, same coupon | Rp20,000, not Rp30,000. |
| Sepatu Rp150.000 + baju Rp300.000; diskon general 10%, cap Rp20.000 | Potongan Rp20.000; net barang Rp430.000 sebelum pajak/ongkir/fee (terkonfirmasi). |
| Shipping Rp12,000, subsidy cap Rp20,000 | Rp12,000 subsidy; no Rp8,000 cash or goods benefit. |
| Pickup, shipping voucher | Ineligible; no redemption consumed. |
| Product source price Rp300,000 → markdown Rp150,000; stackable 10% coupon | Coupon uses Rp150,000, giving Rp15,000; goods payable Rp135,000. Total reduction versus Rp300,000 is 55%, not 60%. |

Allocate an order-level discount to eligible order lines deterministically and persist the allocations. Their sum must equal `Dg`; no line goes below zero. This supports invoice mapping, reporting and net refunds. Do not apply the product markdown again as an order-level discount after already reducing the unit price.

### User-confirmed coupon stacking policy

1. Product markdowns **may stack with one coupon OR one manual promo code**. A goods coupon/code calculates on eligible effective prices after markdown, not on the original source prices.
2. Multiple coupons/codes **cannot stack** on one order. There is one shared slot across goods and shipping, regardless of discovery/activation method: no coupon + coupon, coupon + code, code + code, or goods offer + shipping offer.
3. Markdowned goods are not automatically excluded from coupons/codes. Other campaign eligibility restrictions and caps still apply.
4. The user explicitly selected **one shared coupon/code slot** through the clarification question. Entering a code is not a separate entitlement to an additional discount.
5. No multi-benefit coupon in the initial selected set. Invalid/conflicting selection shows the reason and allowed alternative; never silently replace the chosen offer or increase the amount without renewed approval.

Example: Rp300,000 marked down to Rp150,000 plus a 10%-up-to-Rp20,000 goods coupon gives Rp135,000 net goods. A second coupon, including a shipping coupon, cannot be applied alongside it. The discounted price alone consumes no coupon slot.

## 7. Limits and anti-abuse design

All controls in this section are proposed project requirements. S1/S5/S8 support usage-limit practices; S7/S9/S10 motivate defense against automated and multi-account abuse. Exact controls below are our engineering recommendations.

### 7.1 Configurable financial and usage limits

Every redeemable promotion should support:

- Campaign-wide redemption quota, with optional per-code subquota.
- **Per-customer use limit**, default 1, adjustable to a positive integer; optional daily cap and minimum reuse interval for repeatable campaigns.
- Lifetime campaign identity: renaming/deactivating/reactivating a promo or issuing another code for the same campaign must not reset a customer's usage. A deliberately new campaign can have a fresh limit.
- Maximum benefit per order; optional total customer benefit cap and a hard campaign subsidy budget.
- Minimum eligible spend; optionally eligible unit quantity and maximum discounted units per order/customer/campaign.
- Validity window, allowed products/variants/categories/brands, exclusions, branch, fulfillment type, customer segment, and optional shipping area/service.
- For shipping, cap only the customer shipping component. Insurance, service fees and provider cost overruns are not subsidized unless explicitly configured.

Both quota and budget include **committed paid benefits plus unresolved active holds**. Example: quota 100, consumed 90, reserved 10 means zero capacity, not ten. Budget Rp1,000,000, consumed Rp900,000, reserved Rp100,000 likewise blocks new reservations even if redemption count remains available.

These redemption/expiry/budget controls govern coupon/code promotions, not automatically persistent clearance markdowns. If future promotional campaigns share funding, use a shared funding budget rather than independent counters that each claim the same remaining funds. Any separate markdown quantity/budget restriction needs approval.

### 7.2 Identity: “once per account” is not “once per person”

- Enforce redemption ownership using the authenticated **store client ID**, never a caller-supplied customer ID, billing email, checkout phone, or admin session.
- Require a verified email for redemption. For high-value/new-customer promotions, recommend verified phone identity as an additional hard rule **only after OTP verification and number-change/history policy exist**.
- Normalize phone numbers to a canonical international representation before comparisons. Preserve relevant verified-identity redemption history across account/profile changes under an approved retention policy.
- Limit a high-value campaign across the same verified phone where policy permits. Phone ownership and recycling still do not prove a unique natural person.
- Treat shared IP, device, address, surname or payment instrument as **risk signals**, not automatic proof of fraud. Families/offices share these legitimately. Combine signals, trigger step-up verification or manual review, and offer an appeal path.
- Use only provider-approved payment identity tokens if available; do not store raw card details. Fingerprinting needs privacy disclosure, data minimization, access control and retention decisions. Pseudonymous/HMAC identity keys are still sensitive, not automatically anonymous.
- Define “new customer” as a business rule: proposed baseline is no prior successfully paid order, rather than merely a recently created account. Reserve eligibility atomically so two first-order checkouts cannot both claim it. Decide whether paid-and-refunded history still disqualifies; recommendation is yes to avoid refund resets.

Realistic case: an existing buyer makes a second account. A client-ID-only rule will not link them. A shared verified phone can deny the second redemption; a shared office IP alone should not deny every colleague. Without phone verification, do not advertise a guaranteed one-person limit.

### 7.3 Code guessing, leakage and automation

- Public codes can be memorable. Private customer-specific codes should be randomly generated with sufficient entropy and bound to allowed client IDs/segments. Knowing a hidden code is not identity authorization.
- Hidden codes must not appear in public picker/catalog responses, analytics URLs, client bundles or logs. Avoid leaking exact remaining quota for private promotions.
- Canonicalize codes (`trim`, consistent case) before lookup and enforce canonical uniqueness; set an allowed character set and bounded length. Reject malformed JSON/types/oversized input without an exception-driven 500.
- Rate-limit validation, claim, redemption and order creation with shared enforcement across app instances: account plus trusted client IP, with campaign-specific protection where appropriate. Do not trust arbitrary forwarded-IP headers.
- Use a generic response for unknown/inaccessible private codes. Once authorized, provide useful eligibility errors without exposing another customer's redemption state.
- Suggested starting tuning, not a marketplace rule: 10 validation attempts/minute/account and a higher IP bucket for shared networks; step-up challenge after repeated failures; one unresolved discounted checkout per customer/campaign; backoff for repeated create/cancel loops. Final thresholds need traffic data.
- CAPTCHA is a step-up control, not a universal checkout requirement. It does not stop replay, concurrent quota races, or distributed attacks by itself.
- Claiming a coupon, if supported, does not reserve scarce redemption capacity by default. Tell customers that saving a coupon does not guarantee remaining quota. Guaranteed claim allocations require a separate entitlement/budget model.

### 7.4 Server authority and concurrency

- Browser sends selected cart IDs, promo selection and approval, not authoritative price/discount/subtotal.
- One pricing/discount module evaluates source price → product markdown → permitted goods coupon/code → shipping subsidy, with eligibility, caps, deterministic allocations and money snapshots in one place. Catalog/detail/cart use its product-stage projection; checkout uses its full evaluation. Browsing never reserves quota. A Jubelio adapter translates the evaluated result into provider fields; it must not independently invent eligibility or recalculate campaign benefits.
- Reload owned cart, current eligibility, branch/service, quantities and prices on the server. Aggregate duplicate SKU lines before unit caps; reject invalid/overflow quantities.
- Preview is read-only and provisional. The final order transaction rechecks availability, eligibility, customer limit, quota and subsidy budget together.
- Atomically create order + promotion reservation + stock hold + durable provider intent. Use guarded updates/row locks/constraints so two requests cannot both consume the last quota, budget or per-user use. An in-memory mutex or “count, then insert” is insufficient across processes.
- For adjustable limits greater than one, serialize/check the customer's campaign counter or bounded redemption slots; a simple `(campaign, client)` unique constraint would incorrectly prohibit all second uses.
- Add scoped idempotency for place-order. The same key and request returns the same order; the same key with a different payload fails. A new key must still obey per-user/global limits.
- Store markdown adjustment/version and coupon campaign/code IDs, eligibility basis, line allocation, shipping subsidy, funding source and approved money in the immutable order snapshot.
- Provider calls remain outside DB transactions. Ambiguous writes enter reconciliation/manual review, never a blind resend or premature quota release.
- Sync cannot erase website markdown adjustments, mutate a coupon campaign or rewrite historical order snapshots. Preview/cache expiry cannot extend a time-bounded coupon campaign; order creation uses current markdowns and fresh server eligibility.

## 8. Redemption lifecycle and cancellation/refund policy

Model a durable ledger rather than relying only on `voucher.used`:

`preview (no hold) → reserved (order created) → consumed (authoritative payment)`

Alternative terminal path: `reserved → released` only after the unpaid order is safely terminal. Refund accounting is recorded separately; it does not delete the original redemption.

| Event | Recommended behavior |
| --- | --- |
| Browse/claim/apply preview | No quota/budget consumption; show preview and ineligibility reasons. |
| Order transaction succeeds | Reserve quota, exact subsidy amount and customer capacity; start the existing payment deadline. |
| Provider/Snap fails before any order can succeed | Release once when local/provider outcome is definitively terminal. |
| One payment attempt fails but order permits another attempt | Keep the hold; do not treat an attempt failure as order failure. |
| Authoritative successful payment | Consume once even if Jubelio settlement is temporarily blocked; benefit is already part of the customer's charge. Duplicate callback/sweep must not consume twice. |
| Order TTL expires | Check/reconcile payment and provider cancellation; TTL alone is not proof of failed payment. Release safely through guarded state transitions. |
| Provider outcome unknown/manual review | Hold capacity until resolved; monitor/escalate aged holds so campaigns cannot remain unusable indefinitely. |
| Payment arrives after safe release/cancel | Preserve authoritative paid evidence, block normal fulfillment, record late settlement/manual review. Never silently reacquire already-allocated capacity or exceed budget. |
| Repayment of same live order | Same immutable money and redemption; no new quota, code application or deadline extension. |
| Customer return/refund | Refund customer-paid allocated net value under approved refund policy; never cash out nominal coupon value or merchant shipping subsidy. Record refunds without silently restoring customer eligibility. |
| Merchant-caused cancellation | A support replacement voucher may be issued with an audited policy; do not bypass campaign limits by deleting history. Restoration is a business decision. |

Recommendation: refund/cancellation after successful payment does not automatically restore the per-customer use. Maintain gross campaign exposure separately from net/refunded reporting; do not automatically recycle a hard loss budget based on refunds without accounting approval.

**Partial returns require explicit policy.** Persisting net line allocations prevents refunding undiscounted prices, but does not by itself solve threshold/BOGO exploitation. Example: a customer buys Rp200,000 to meet a Rp150,000 threshold, then cancels Rp100,000 before fulfillment. Re-evaluate remaining eligibility and seek customer approval of changed money/refund before a partial cancellation; do not silently debit additional money. Post-delivery returns must follow an approved consumer/refund policy, possibly requiring return of a gift or the full bundle where legally permitted. Do not claim all threshold abuse is solved by a quota counter.

## 9. Suggested admin menu and customer experience

A single **Discounts** menu can retain the requested tabs:

- **Product markdowns / Price adjustments**: a product/SKU price table, current base/effective prices, manual or bulk adjustment, Excel import, explicit restore-base action and change history. No mandatory campaign/event period; branch scope, floors and optional safeguards require approval.
- **Coupons**: offer yang dipilih langsung, benefit barang general atau subsidi ongkir, serta persyaratan dan limits yang disetujui. Tidak ada kontrol targeting produk/kategori/brand atau wallet claim pada fase awal.
- **Promo codes**: manual/hidden activation, shared or customer-bound code, same benefits/limits, code subquotas and distribution label.
- **Usage & performance**: reserved versus paid redemptions, released/ambiguous holds, gross/net subsidy, campaign budget, successful orders and rejected-risk counts.

Usulan kontrol kupon/kode: status draft/scheduled/active/paused/expired/exhausted; timezone; minimum belanja; persentase/nominal; plafon; kuota global/per-user; budget; stacking; terms; preview; audit trail. Targeting produk/kategori/brand tidak masuk form fase awal; audience dan kontrol lainnya tetap mengikuti keputusan tiket masing-masing. “Pause” blocks new reservations but does not remove discounts from already approved orders. Persistent markdown controls instead concern current/replacement prices, review, explicit apply/removal and audit; they do not inherit campaign dates or redemption states.

Permission design should separate viewing, editing and high-risk activation/budget changes, fit existing authorization ceilings/branch scopes, and use transactional audit events. Significant subsidy increases can require a second approver; the threshold is a business decision. Do not allow an admin to lower limits below paid plus reserved exposure or delete redemption history.

Customer checkout should show:

- Product markdown already reflected in unit prices.
- Available coupons plus “Enter promo code” share one offer slot across goods and shipping. Selecting another coupon or entering a valid code replaces the current offer only after explicit confirmation if needed; it never adds a second offer.
- Plain terms: minimum eligible purchase, cap, expiry, remaining personal uses where appropriate, shipping/service exclusions and stacking.
- Separate goods discount, shipping before subsidy, shipping subsidy, net shipping, approved PPN and final total.
- Clear reason for rejection: insufficient eligible spend, exhausted quota, already used, ineligible products/fulfillment, or conflicting offer. Private-code enumeration remains protected.
- Fresh approval when final quote/eligibility changes; never silently place an order at a higher charge.

### 9.1 Proposed admin markdown UX and bulk Excel import

This section responds to the user's requested bulk-markdown workflow. It is a UX recommendation, **not approved implementation scope**. Existing admin products are a synced catalog with detail actions, while marketing is still a placeholder and is absent from the current sidebar link array. [products page L96–208](../../apps/admin/src/app/admin/products/page.tsx#L96), [sidebar L65–80](../../apps/admin/src/components/AdminSidebar.tsx#L65), [marketing placeholder](../../apps/admin/src/app/admin/marketing/page.tsx)

**Revised after user correction: price-adjustment-first, not campaign-first.** Keep a Discounts menu with Price adjustments (harga coret) / Coupons / Promo codes / History, or place the same price table under Products as a navigation choice for the later spec. The markdown screen lists products/variants and their source base price, current website price, derived reduction, last change and actions. A product detail “Adjust price” action opens the same variant-price editor. No campaign creation is required. Use the existing admin's restrained operational table style; prioritize readable money columns, before/after comparison, persistent row-error labels and keyboard-accessible actions.

For markdown entry, show:

1. Target variants and any approved price scope; optional business reason such as “Clearance of old footwear series”, not a mandatory campaign name/date.
2. Three paths into the same pending change: **edit individual variants**, **bulk adjust selected variants**, or **upload Excel for row-specific prices**. Filters can narrow existing brand/category metadata; series targeting should use available identifiers or explicit SKU selection rather than assuming Jubelio populates a series field. Show selected product and resolved variant counts. Selection across pages must distinguish page rows from all matching rows.
3. Preview: SKU, product, size/color, current source base price, current effective website price, proposed effective price, resulting reduction and validation status. Distinguish a new markdown from replacing an existing markdown and flag rows changed by another admin since preview.
4. **Review → Apply adjustments**, with permission checking and exact counts. Uploading alone never changes live prices. Saving an uncommitted import for later review is optional workflow storage, not a marketing campaign.

Suggested four-step Excel flow: **Download/export template → Upload and validate → Review current versus new prices → Confirm apply**. Offer a blank template and an export prefilled from selected variants; the latter reduces SKU typing errors. No campaign date/name columns are required. Record an import batch ID and optional clearance reason for audit; the batch groups an administrative action, not the business lifetime of its prices.

Proposed worksheet columns (names shown as possible UI/export labels, not a finalized file contract):

| Column | Editable? | Meaning/example |
| --- | --- | --- |
| `sku` | Required identity; text | Exact variant SKU, e.g. `SHOE-BLACK-42`; resolve to the stored variant ID server-side. |
| `new_price` | Yes, recommended initial format | Explicit effective unit price, e.g. `150000` for Rp150,000. A price equal to base can explicitly remove a markdown only if that file operation is approved; blank cells must not imply removal. |
| `current_price_reference` | Reference only in prefilled export | Current effective website price at export; supports visible before/after review, never authoritative imported money. |
| `product_name` | Reference only in prefilled export | Human-readable product name; never authoritative matching. |
| `variant` | Reference only | Size/color helps the operator identify the row. |
| `base_price_reference` | Reference only | Price when exported; never accepted as authoritative imported money. |

One worksheet row targets **one variant SKU**, not an ambiguous product name or barcode. Schema guarantees unique SKU, while barcode can repeat. [variants L113–139](../../packages/db/src/schema/products.ts#L113) Preserve SKU text/leading zeros. If SKU disappears/changes, report the exact missing row; do not silently use fuzzy product-name matching. Server price and identity prevail over spreadsheet reference columns.

Validation UX should summarize “100 rows: 97 valid, 3 errors” and permit filtering to errors, downloading an error workbook, and re-uploading after correction. Row errors include unknown/duplicate SKU, malformed numeric value, invalid target price, wrong column header, disallowed variant, changed base price and stale current adjustment. Replacing an existing markdown is a visible price change, not automatically a campaign-overlap error. Identify worksheet row number and reason in text, not color alone. Do not evaluate formulas or silently treat formatted ambiguous numeric text as a different amount; document plain numeric cells with no `Rp`/percent symbol and reject ambiguous values with actionable messages.

**User-confirmed error policy during wayfinder charting:** apply the valid rows and explain each invalid row's error. Example: 100 input rows, 97 valid → apply those 97 after preview confirmation and report the three failed rows with worksheet numbers, SKUs and actionable reasons; their prices remain unchanged. Do not report the entire file as a success or silently drop error rows. Exact apply-time conflict handling, retry of failed rows, file-fatal versus row-level errors and large-job execution are still decisions for the bulk-import ticket; do not assume they are settled by accepting partial validation results.

Revalidate current base prices, current markdown versions, target eligibility and permissions before applying. If a base price or existing adjustment changed after preview, show affected rows and require renewed review instead of overwriting stale prices. Proposed safety controls: bounded `.xlsx` file/row/decompressed limits; reject macro-enabled files, formulas and unexpected workbook structure; server-side parsing and validation; audit uploader, apply actor, import/version IDs, optional reason and before/after prices; do not treat the existing image-upload endpoint as a safe spreadsheet-import module without review.

Practical case: 100 older shoe SKUs need lower selling prices to reduce dead stock. Admin exports those variants, fills `new_price`, uploads, reviews base/current → proposed prices, then confirms applying the 97 valid rows. Three invalid rows stay unchanged and receive explicit explanations; admin can correct and retry them. Recommended behavior is that the prices remain until explicitly changed/restored, with no campaign end date. Base prices are not written back to Jubelio and import creates no SO; later orders snapshot the markdown plus any allowed coupon/code and send the verified discount mapping.

User confirmed fixed final prices across all branches and direct coupon selection without a prior claim. Open choices for a later spec: exact input/template/version and explicit restore operations, file/row limits, large-job and apply-conflict strategy, source-price-change policy and permissions. No Excel parsing library has been selected or implementation started.

## 10. Integration dependencies and possible accounting paths

### A. Confirmed website ownership and one engine

Adjustment harga produk serta pembuatan, penjadwalan, kuota, dan budget kupon/kode dikelola website. Targeting kupon/kode produk/kategori/brand tidak masuk fase awal. Product markdowns do not require a campaign or event window. Jubelio is the source of undiscounted base unit prices and stock/sales operations; importing a Jubelio promotion engine is not the selected direction.

Use a website overlay without overwriting sync-managed price columns. In the inspected sync, `productVariants.price` mirrors the variant's `sell_price`; the product-level `basePrice` mirrors group `sell_price`. Those two source values need not equal one another. The proposed markdown baseline for a selected variant is its undiscounted source price, not another variant's cheapest card price. Existing docs describe `basePrice` as RRP; that historical display contract must be explicitly reconciled with the newly selected base-price concept, rather than silently relabeling group price as verified historic variant price.

One module can hide rule selection, eligibility, calculation stages, caps, allocation and rounding behind a small interface. Its catalog projection exposes source/effective unit prices and markdown display; its checkout evaluation adds selected coupon/code and shipping effects. Quota reservation is a transactional operation on the evaluated snapshot, not a side effect of displaying a product card. A provider adapter maps that result to Jubelio fields; markdown and coupon/code policy remain owned by the website.

### B. Fresh first-party Jubelio contract and evidence level

The follow-up research fetched the public official WMS spec from **https://docs-wms.jubelio.com/dist.yaml** with GET and read the relevant schemas. The full file differs from the repository copy, but these normalized schema blocks match exactly: `saveSalesOrderRequest`, `getSalesOrderResponse`, `saveInvoiceRequest`, `getInvoiceResponse`, `saveSalesPaymentRequest`, and `createInvoiceRequest`. This strengthens evidence of current field existence; it does **not** prove nonzero-discount runtime semantics. [S11]

`https://docs.jubelio.com/dist.yaml` returned HTML, not the expected YAML, during direct GET; it was not used as a fresh spec. Context7 resolved `/websites/jubelio` and corroborated indexed endpoint/field material, but also returned webhook/distribution and purchase-order examples. Those are not evidence that an INTERNAL SO accepts all the same fields/formulas. [S11, S12]

#### Writable fields documented for `POST /sales/orders/`

Source: `saveSalesOrderRequest`, [repository L24893–25179](../../docs/jubelio-api/dist.yaml#L24893), rechecked against fresh official spec L25606–25885.

| Field | Documented type/meaning | Recommended use or unresolved semantics |
| --- | --- | --- |
| `items[].price` | number, Item Price | Snapshot the original undiscounted variant unit price to preserve gross sale versus discount visibility. |
| `items[].qty_in_base` | number, purchase quantity | Quantity basis for gross line value; explicitly test quantities 1 and greater than 1. |
| `items[].disc` | number, Item Discount; required per item | Likely percentage-oriented, consistent with Jubelio's manual SO article listing percentage and value, but the API field description itself does not define a unit or relation to `disc_amount`. Do not assume it is an additional independent discount. [S13] |
| `items[].disc_amount` | number, Item Discount Amount; required per item | Candidate nominal discount representation for allocated markdown plus goods coupon. The schema does not explicitly state per-unit versus whole-line amount. |
| `items[].amount` | number, Item Total Amount; required per item | Candidate final line money after its discount/tax; must match independent SO/invoice GET evidence. |
| `sub_total` | number, Sub Total; required | Candidate sum of gross source-unit-price × quantity. Confirm provider behavior. |
| `total_disc` | number, Total Discount; required | Candidate aggregate of item discounts, not an extra subtraction on top of those discounts. Whether/how it incorporates `add_disc` is not defined here. |
| `add_disc` | number, Additional Discount; required | Candidate order-level additional discount. Spec explicitly warns to calculate tax for each item when using PPN. Prefer zero in the initial candidate mapping when all goods reductions are already allocated into lines. |
| `tax_amount`, `total_tax`, `is_tax_included` | item tax amount, aggregate tax and included flag | Preserve approved tax architecture; do not activate provider PPN by accident while adding discounts. |
| `shipping_cost`, `insurance_cost` | optional numbers | Cost fields exist, but net/gross subsidy and contribution to SO/invoice totals are not defined sufficiently for our shipping promotion. |
| `grand_total` | number, Grand Total; required | Final provider ledger amount; not necessarily equal to website total while website-only PPN/shipping architecture remains. |
| `add_fee`, `service_fee` | required numbers | Keep existing zero provider fees unless separately scoped and verified. |

There is no documented rule-engine field here for `maxDiscount`, eligible category/brand, per-user quota, campaign budget, or our public/manual activation method. Evaluate those in the website, then send the final allocated monetary result. This is how a capped percentage is represented even when a single percentage field cannot express its cap.

#### Response fields are not automatically writable fields

`getSalesOrderResponse` documents the following additional fields, **absent from the inspected create/edit request schema**:

- `discount_marketplace`: [L25490](../../docs/jubelio-api/dist.yaml#L25490).
- `voucher_amount`: [L25690](../../docs/jubelio-api/dist.yaml#L25690); its schema uses the malformed key `typr`, so even its type declaration needs caution.
- `original_shipment_cost`, `shipment_promotion_id`, `shipping_cost_discount`: [L25694–25713](../../docs/jubelio-api/dist.yaml#L25694).
- `shipping_fee_discount_platform`, `shipping_fee_discount_seller`: [L25746–25753](../../docs/jubelio-api/dist.yaml#L25746).
- Item `disc_marketplace` and `original_price`: [SO response items L25866–26001](../../docs/jubelio-api/dist.yaml#L25866).

These are useful candidates for reading/reporting shipping funding and channel discounts, but not proof that our `source: 1` INTERNAL create accepts them, that they are writable through another endpoint, or that they reduce invoice/payable totals. Do not impersonate a marketplace source to unlock them. Confirm with Jubelio or isolated sandbox before relying on them. Header `add_disc` must not silently absorb shipping subsidy into goods discount/tax base.

### C. Candidate mapping for the selected benefits — not runtime-verified

**Preferred research recommendation:** send goods reductions explicitly as nominal line allocations, aggregate once into `total_disc`, and keep `add_disc = 0`. Rekomendasi ini mendukung benefit general dengan plafon dan alokasi ke baris tanpa menghitung potongan dua kali; targeting/exclusion produk bukan scope awal. It fulfills the user's direction that SO shows discounts; precise field semantics remain a release gate.

| Website benefit | Candidate provider mapping |
| --- | --- |
| Product markdown | Preserve source `price`; allocate source minus effective price into `disc_amount` for the line. |
| Capped percentage coupon/code | Website computes the capped eligible benefit, then allocates it into eligible `disc_amount` lines. Do not send a raw 10% expecting Jubelio to know a Rp20,000 cap. |
| Fixed amount per order | Compute once for the eligible order pool, then proportionally allocate into eligible lines. Do not subtract the full coupon from every line/unit. |
| Diskon barang general (fase awal) | Semua barang order masuk dasar diskon pada harga setelah markdown; alokasi ke baris tetap perlu keputusan. Targeting produk/kategori/brand hanya future-only. |
| Shipping subsidy | Keep separate from goods discounts. Writable provider shipping-subsidy representation remains unverified; see §10.E. |

With all goods reductions represented nominally, a candidate is `disc = 0`, explicit `disc_amount`, and explicit net `amount`. **It must be tested**, not assumed: the provider may recalculate from `disc`, ignore a nominal-only amount, or interpret nominal amount per unit. An alternative consistent percentage-plus-nominal representation requires proving they describe the same discount rather than being applied twice. Do not force a rounded effective percentage for capped/fixed coupons and assume its recalculation matches the desired Rupiah amount.

Candidate formula for a zero-provider-tax, zero-fee, goods-only SO:

```text
grossLine_i = sourceUnitPrice_i × quantity_i
lineDiscount_i = markdownAllocation_i + goodsCouponAllocation_i
netLine_i = grossLine_i − lineDiscount_i
sub_total = sum(grossLine_i)
total_disc = sum(lineDiscount_i)
add_disc = 0
grand_total = sub_total − total_disc
```

These are **proposed consistency invariants**, not a formula specified/proven by the live provider. Existing code already contains gross-minus-nominal arithmetic, but its guard rejects all nonzero-discount requests before serialization; dormant arithmetic is not sandbox evidence. [builder L455–503](../../apps/store/src/lib/jubelio-sales-client.ts#L455)

Worked example A — one pair, applying the now user-confirmed markdown-plus-coupon stacking policy:

- Jubelio base unit price Rp300,000; website markdown to Rp150,000 → markdown Rp150,000.
- 10% coupon capped at Rp20,000 computes on Rp150,000 → coupon Rp15,000.
- Proposed SO `price = 300000`, `qty_in_base = 1`, `disc_amount = 165000`, `amount = 135000`; `sub_total = 300000`, `total_disc = 165000`, `grand_total = 135000`, with zero provider tax/fees and `add_disc = 0`.
- Website can still show markdown and coupon separately using its own allocation snapshot even though SO aggregates their line benefit. **These snapshots must distinguish source gross subtotal, product-markdown reduction, effective subtotal after markdown, coupon reduction and final net goods.** In this example, the coupon base is Rp150,000 and coupon reduction Rp15,000; provider gross is Rp300,000 and provider aggregate discount Rp165,000. Never subtract the provider aggregate Rp165,000 from the already-marked-down Rp150,000 subtotal.

Worked example B — quantity two, deliberately distinguishes per-unit from whole-line semantics:

- Base Rp300,000 × 2 = Rp600,000; markdown Rp150,000 per pair → effective goods Rp300,000.
- 10% coupon would be Rp30,000 but cap gives Rp20,000.
- **If `disc_amount` is whole-line**, candidate line discount is Rp320,000, line amount Rp280,000, `sub_total = 600000`, `total_disc = 320000`, `grand_total = 280000`.
- If provider instead expects Rp160,000 per unit, the whole-line payload would be wrong. The sandbox must settle this before implementation is considered ready for live use.

Worked example C — fixed coupon allocation:

- Eligible effective lines Rp150,000 and Rp100,000; per-order coupon Rp25,000.
- Proposed proportional allocations Rp15,000 and Rp10,000, not Rp25,000 on both. Add each allocation to that line's markdown once; deterministic rounding preserves the coupon total for other ratios.

No values above were sent to Jubelio. Markdown-plus-one-coupon/code stacking and one shared offer slot across goods/shipping are now user-confirmed. Tax-free provider examples preserve today's separation only for illustration; website tax must use its approved net taxable basis, and tax architecture still needs confirmation.

### D. SO → invoice → payment and existing safety gates

The documented conversion request is just `salesorder_id`; it does not carry a new coupon or replacement discount payload. Therefore confirm discounts on SO **before** payment initiation, then verify how invoice conversion preserves them via invoice GET. [conversion schema L26987–27005](../../docs/jubelio-api/dist.yaml#L26987)

`getInvoiceResponse` exposes `sub_total`, `total_disc`, `total_tax`, `grand_total`, `add_disc` and item `price`, `qty_in_base`, `disc`, `disc_amount`, `amount`. Several amounts are documented as decimal strings; parsers must support documented numeric/string forms without losing precision. The invoice's `disc_amount` description is misleadingly “Item Total Amount”, so do not infer semantics from that description alone. [invoice schema L24592–24844](../../docs/jubelio-api/dist.yaml#L24592)

`saveSalesPaymentRequest` sends header `amount` and per-invoice `items[].payment_amount`. Payment should settle the **verified discounted invoice payable**, not the old gross subtotal. The schema does not provide a new coupon discount at payment time. [payment schema L27161–27229](../../docs/jubelio-api/dist.yaml#L27161)

Required later integration review:

1. Extend approved nonzero-discount create validation rather than deleting safety checks: [create guard L418–437](../../apps/store/src/lib/jubelio-sales-client.ts#L418).
2. Preserve/verify item discount fields in the snapshot parsers; current SO/invoice item snapshots retain price/amount but omit `disc`/`disc_amount`, although SO create confirmation already checks aggregate discount and expected line amount: [SO parser L1150–1193](../../apps/store/src/lib/jubelio-sales-client.ts#L1150), [confirmation L1454–1497](../../apps/store/src/lib/jubelio-sales-client.ts#L1454), [invoice parser L1555–1585](../../apps/store/src/lib/jubelio-sales-client.ts#L1555).
3. Update the higher-level invoice verifier that still expects `amount = price × quantity` and `grand_total = order.subtotal`: [lifecycle L746–762](../../apps/store/src/lib/jubelio-sales-lifecycle.ts#L746). The lower-level invoice/SO verifier already compares `totalDisc` and grand total, but this does not remove the gross-only lifecycle checks. [L1604–1620](../../apps/store/src/lib/jubelio-sales-client.ts#L1604)
4. Persist explicit provider expected gross/discount/net values and use verified invoice payable for the Jubelio payment; current payment code uses `order.subtotal`: [L827](../../apps/store/src/lib/jubelio-sales-lifecycle.ts#L827). Do not silently redefine existing subtotal without a migration/reporting decision.
5. Review channel-status mirrors' full-payload edits: current guard rejects nonzero discounts and assumes gross totals. Otherwise a legitimate discounted paid order can enter mirror investigation even if checkout/settlement works. [edit guard L614–672](../../apps/store/src/lib/jubelio-sales-client.ts#L614)
6. Update website line snapshots, PPN basis, Midtrans item sums, repayment, delivery approval comparisons, cancellation, refund reporting and audit. Website order schema currently has a single `discount` value and source/effective/provider accounting snapshots need deliberate design: [orders L172–190](../../packages/db/src/schema/orders.ts#L172).

Full INTERNAL SO → independent GET → invoice conversion → invoice GET → payment → payment GET evidence is needed for nonzero discounts. Preserve the existing once-only durable-intent/ambiguous-outcome rules. No tax architecture, endpoint switch, marketplace source switch or weakened remote-write safety is implied by approving discount types.

### E. Shipping subsidies and PPN

Current delivery SO excludes shipping, while website/Midtrans charges shipping and website PPN. Therefore a shipping coupon can leave the goods SO unchanged, but the user now wants the provider mapping researched and this must be made explicit rather than silently assuming all discounts are goods discounts.

Research result: `shipping_cost_discount` and separate platform/seller funding fields exist in SO **responses**, but the inspected create/edit schema does not document them. A writable shipping-subsidy mapping cannot be declared verified from this alone. Options needing a decision and evidence are: (a) retain goods-only SO and account for shipping subsidy in website/shipping funding records, or (b) extend the SO/invoice contract to carry net/gross shipping and verified subsidy fields. Option (b) is a wider money-contract change, not merely setting `disc_amount`.

In either option, persist quoted provider shipping cost, customer shipping before subsidy, subsidy and customer net shipping separately. PPN, Midtrans line sums, re-quote approval, immutable delivery snapshots, booking funding and refunds must agree with approved tax policy. Never book a smaller provider shipping charge merely because the customer received a coupon, or deduct shipping again through both goods discount and net shipping.

### F. Proposed sandbox research matrix and permissions

Before any business write, use an isolated, explicitly confirmed Jubelio test account, designated disposable stock/item/customer records, unique research references and controlled amounts. No existing order should be edited. Calls need separate user permission for their **complete scope**: authentication `POST /login`, disposable SO creation, invoice conversion, invoice-payment creation and any test cleanup/cancellation. Permission for login alone is not permission for the rest.

A useful later matrix:

| Case | Evidence to collect, sanitized |
| --- | --- |
| Baseline zero discount | Reconfirm existing money envelope for the chosen test SKU. |
| `disc` only, nominal-only, consistent both | Determine which fields are authoritative/recalculated and whether the same discount is ever applied twice. |
| Quantity 1 versus 2 | Settle per-unit versus whole-line nominal semantics. |
| Dua baris barang pada diskon general | Verifikasi alokasi nominal yang tepat dan aggregate header; tidak ada exclusion produk pada fase awal. |
| Percentage hitting a monetary cap | Verify the final nominal amount remains capped despite percentage metadata. |
| `add_disc` alone and with line discounts | Verify header aggregation, net payable and tax handling; do not infer it from the name. |
| SO conversion and payment | Invoice carries the intended amounts; payment settles exactly the verified payable once. |
| Shipping representation | Confirm writable fields and net/gross/funding semantics with Jubelio; test separately from goods, only if this path is approved. |
| Cancellation and mirror edit | Pre-invoice cancel restores stock; approved full-payload marker edit preserves all discounted money. Post-invoice cancellation is not assumed safe. |

Do not use deliberately malformed payment amounts or modify existing orders to explore error behavior. Log only IDs, request case labels, quantities and relevant money/discount fields; never tokens, customer identities or raw provider bodies. Ambiguous writes stop for GET-only reconciliation/manual review, never blind retries.

**Verification performed in this follow-up:** public documentation GET, schema comparison, code inspection and arithmetic examples only. No authenticated business GET, login, SO/invoice/payment POST, unit/E2E run or runtime exploit test was performed. No reusable auth token was found in the inspected process/standard local env-file locations; importing the existing client can initiate login/re-login POST, so it was not invoked. This statement does not imply credentials could not exist elsewhere.

### G. Conceptual data seams, not a migration spec

Suggested concepts: current markdown adjustment and price revision/history; administrative bulk price-change batch; coupon/code campaign/rule version; activation code(s); eligibility targets; per-client usage capacity; durable redemption/reservation ledger; funding budget; order discount allocations/snapshot; optional claimed entitlements; optional sale-unit ledger. The existing voucher table may be evolved or migrated after a compatibility decision. Schema remains owned only by `packages/db/src/schema/`; seed/test fixtures must follow the eventual approved schema.

## 11. Verification matrix for a later implementation

These are proposed tests, **not executed results**:

1. Known selected-scope examples: Rp300,000 → Rp150,000; 10% cap Rp20,000; fixed amount applied once per order and allocated to eligible lines; shipping Rp12,000 capped at Rp20,000; pickup rejects shipping.
2. Keranjang campuran produk: seluruh barang order masuk dasar diskon barang general pada harga setelah markdown. Usulan minimum belanja mengecualikan PPN/fee/ongkir masih perlu konfirmasi; targeting produk/kategori/brand bukan acceptance fase awal.
3. Variant source-price sync: persistent markdown survives; effective detail/cart/filters/checkout agree; old order snapshots stay unchanged; absolute targets revalidate. New markdown replaces the prior adjustment rather than compounding; explicit restore removes it for new orders.
4. Boundaries: exact campaign start/end, zero/negative/NaN/malformed/oversized input, quantities/overflow, deterministic rounding and allocation sums.
5. Concurrency: many real-DB requests racing for one quota slot, one remaining budget and one personal use produce only the allowed reservations. Also test adjustable personal limit 2 and shared campaign across multiple codes.
6. Replay: duplicate place-order, changed body with same idempotency key, duplicate/out-of-order callbacks, webhook/sweep races and cancel/payment races do not double-consume or double-release.
7. Lifecycle: retryable payment failure retains hold; safe terminal expiry releases; ambiguous provider remains held; late payment enters review; campaign expiry/pause does not reprice existing valid orders.
8. Abuse: hidden codes not discoverable; canonical code uniqueness; customer-bound code stolen by another client rejected; shared IP alone not denied; OTP identity reuse checked only if verification exists.
9. Refunds: net allocated line amounts, no subsidy cash-out, no automatic user-limit reset; threshold-sensitive partial cancellation and merchant replacement audit. BOGO/gift cases are future-only while those benefits remain outside the selected initial scope.
10. Payment/provider accounting: order + Snap/re-payment sums agree; independently verified Jubelio SO/invoice/payment amounts match the selected accounting model, including cancellation and mirrors.
11. Admin authorization/audit: unauthorized direct API writes rejected; branch scope respected; budget cannot fall below exposure; every rule change traceable.
12. Playwright: public coupon selection, manual code application, conflicts, max-use rejection, sale-variant selection, delivery/pickup switching, changed-total approval and checkout/order-detail breakdown.

## 12. Business decisions still needed before a plan/spec

Research can continue without resolving these, but implementation cannot:

**Already settled by user feedback:** website-owned discounts over Jubelio source prices; explicit discounts in SO; benefit awal persentase dengan plafon/nominal per order/subsidi ongkir, dengan diskon barang general tanpa targeting produk/kategori/brand, plus persistent product price adjustments for clearance rather than campaign-first markdowns; markdowns may stack with one coupon/code, and goods/shipping coupons/manual codes all share one slot. User additionally confirmed fixed final markdown prices shared by all branches, applying valid Excel rows with explicit per-row error explanations, and direct coupon selection without a prior claim. No advanced-benefit, Jubelio-owned-campaign, branch-price, persistent-percentage or stacking question remains.

1. Exact markdown input/template controls, rounding and source-price-change/restore policy.
2. Verified nominal-line versus header-discount semantics and accounting representation, including whether shipping remains outside SO or becomes part of its verified money contract.
3. Coupon/code presentation and replacement confirmations: direct selection without prior claim is settled; exact visible eligibility feedback still needs UX review.
4. Identity friction: baseline verified email/account or additional verified-phone requirement for high-value campaigns?
5. Exact per-user/global quotas, budget, floor/zero-order policy, repeat-use window and definition of “new customer”.
6. Threshold/rounding/PPN basis, funding responsibility, partial/full refund rules and eligibility restoration.
7. Role/scope and approval thresholds for creating/activating campaigns and increasing subsidy budgets.

Recommended next step: agree the product decisions and accounting path, then write a complete gated spec. Do not mark this research Ready or use it as approval to implement.

## 13. Database design follow-up

A dedicated [long-term database research proposal](discount-database-design.md) captures the requested schema, field/constraint recommendations, checkout reservation lifecycle, migration caveats and concrete data/use cases for persistent markdowns, capped percentages, fixed order discounts, subsidi ongkir dan kode manual; pembahasan eligibility produk/kategori/brand hanya referensi extension future-only. It compares primary Saleor, Vendure, commercetools and PostgreSQL 16 documentation with the current shared schema.

Core recommendation: separate persistent SKU price revisions/current pointers from stable coupon/code offer identities and versioned terms, then freeze all applied money in order snapshots/component allocations. Use relational identity/financial constraints plus typed/versioned JSONB extension parameters, not a generic unvalidated rule blob. New mechanisms reuse these records but still require approved behavior, an evaluator, tests and any necessary specific ledger/schema additions. This remains a proposal, not schema implementation or plan approval.

## 14. Wayfinder publication

The owner selected a complete specification ready for review as the destination, then explicitly approved the complete [twelve-decision proposal](discount-wayfinder-proposal.md) and its dependencies/publication boundaries. The canonical [Discount Design Wayfinder](../../.scratch/discounts/map.md) is published in the existing Local Markdown tracker; all children start open/unclaimed. Charting records standing decisions but resolves no child. Complete-spec approval, implementation, delegation, provider requests and commits retain their separate gates.

## Sources and access limitations

Primary documentation was consulted through web search and extracted page text. Sources show practices of the named platform, not universal rules or evidence of Okcir behavior.

- **S1 — Shopee Indonesia, “Mengisi Rincian Voucher Toko Saya”**: https://seller.shopee.co.id/edu/article/1863 . The web-search result supplied substantive first-party text (nominal/percentage/cashback, max/min, quota, maximum per buyer, visible/hidden and code entry without claim). Direct fetch returned 404; conclusions are limited to the retrieved search extract, not a successful interactive page audit. Corroborating first-party search result: https://seller.shopee.co.id/edu/article/6972 .
- **S2 — Shopify, Discount types**: https://help.shopify.com/en/manual/discounts/discount-types . Direct fetch read successfully; simple/advanced/multi-benefit types.
- **S3 — Shopify, Buy X get Y discounts**: https://help.shopify.com/en/manual/discounts/discount-types/buy-x-get-y . Substantive first-party search extract; gift/quantity/eligibility/use controls.
- **S4 — Shopify, Combining discounts**: https://help.shopify.com/en/manual/discounts/discount-combinations . Substantive first-party search extract; classes, opt-in combinations, ordering and shipping constraints.
- **S5 — Shopify, Discount codes FAQ**: https://help.shopify.com/en/manual/discounts/discounts-faq . Substantive first-party search extract; submitted-checkout code holds, release after payment failure, limits and distinction from sale pricing. Lifecycle recommendations here are adapted to our order/provider flow, not copied attempt-for-attempt.
- **S6 — Stripe, Add discounts (hosted Checkout)**: https://docs.stripe.com/payments/checkout/discounts?payment-ui=stripe-hosted . Followed and read the official Markdown variant at https://docs.stripe.com/payments/checkout/discounts.md?payment-ui=stripe-hosted ; coupon/code separation, shared quota, customer restriction, first-time transaction, minimum amount and expiration. Stripe is a reference only; the project uses Midtrans.
- **S7 — OWASP, API6:2023 Unrestricted Access to Sensitive Business Flows**: https://owasp.org/API-Security/editions/2023/en/0xa6-unrestricted-access-to-sensitive-business-flows/ . Direct fetch read successfully; business-flow automation, reservation abuse and layered mitigation.
- **S8 — WooCommerce, Managing Coupons**: https://woocommerce.com/document/coupon-management/ . Direct fetch read successfully; fixed-cart/product/percentage, restrictions, quantities, per-user/global limits, taxes and shipping separation. Feature availability can vary by version; not used as library API instructions.
- **S9 — Lazada Indonesia, Terms of use, “Syarat & Ketentuan Penggunaan Voucher”**: https://www.lazada.co.id/terms-of-use/#tov . Substantive first-party search extract from https://www.lazada.co.id/terms-of-use/ ; default use, multi-account/multiple-checkout misuse, combination restrictions and no cash conversion. General terms may differ from specific campaigns.
- **S10 — Tokopedia, Terms & Conditions, section M “Promo” and section B**: https://www.tokopedia.com/terms . Substantive first-party search extract; one-account participation, matching payment/account identity, shipping subsidy refunds and automation restrictions. The searched coupon-help page yielded only its heading/navigation, so no detailed coupon claims rely on that page.
- **S11 — Jubelio, official public WMS OpenAPI spec**: https://docs-wms.jubelio.com/dist.yaml . Direct public GET returned HTTP 200 `text/yaml` in the follow-up. Relevant schemas read from the downloaded public document and compared to [repo reference](../../docs/jubelio-api/dist.yaml): `saveSalesOrderRequest` (fresh L25606–25885), `getSalesOrderResponse` (fresh L25893–26757), `getInvoiceResponse` (fresh L25305–25557), `saveSalesPaymentRequest` (fresh L27874–27942), and `createInvoiceRequest` (fresh L27700–27708). The six schema blocks named in §10.B match the repository after line-ending normalization, despite differing full-file hashes. Fresh copy was temporary; repository vendor spec was not overwritten. Documentation host is not the business API host and does not prove nonzero runtime behavior.
- **S12 — Context7 Jubelio documentation lookup**: resolved `/websites/jubelio`, two targeted discount/schema queries. Indexed material cites https://docs.jubelio.com/ and its spec. Endpoint/field corroboration only; unrelated webhook/distribution and purchase-order examples were not treated as live INTERNAL-SO semantics. Direct fetch of the main docs page failed through web extraction; direct GET of its purported YAML path returned HTML. The public WMS YAML in S11 supplied the actual fresh schema evidence.
- **S13 — Jubelio, “Langkah Membuat Sales Order yang Sesuai”**: https://jubelio.com/sales-order/ . Direct fetch read successfully; lists sale price, quantity, percentage discount, nominal discount and total as SO data. It does not define API calculation precedence or nominal-per-unit semantics.

Extraction limitations: Shopee direct fetch failed as noted; no logged-in seller console was inspected. A separate OWASP WSTG deep-link fetch returned generic guide content, not the intended test chapter, so no chapter-specific claims rely on it. No claim is made to have exhausted every marketplace's promotion types. Tax/legal/identity-retention policies require qualified business review before production.
