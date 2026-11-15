# Final Implementation Plan — WhatsApp, Admin Password Reset, and PPN

## 1. Objective

Implement the following approved changes in the marketplace monorepo:

1. Add a configurable floating WhatsApp Business button to every storefront page.
2. Fix the admin user password-reset flow that currently returns `Invalid request body` in generated-password mode.
3. Add configurable PPN to customer payments, defaulting to 11%, calculated after discounts and rounded upward to the next whole Rupiah.

Implementation must follow TDD, use the shared database schema in `packages/db`, preserve the separation between store and admin Better Auth instances, include structured backend logging, and update feature/API documentation.

---

## 2. Confirmed Product Decisions

### WhatsApp

- Seed a valid dummy URL:

  ```text
  https://wa.me/6281234567890
  ```

- Do not include a prefilled message.
- Admin users adjust the URL through the existing footer configuration UI.
- The existing WhatsApp `enabled` switch controls both:
  - the WhatsApp icon in the footer; and
  - the floating WhatsApp button.
- Footer configuration remains HQ-only.

### PPN

- Default/fallback rate: **11%**.
- Store the adjustable rate in `system_config`; there is no admin UI for the rate.
- IT changes the rate directly in the database and restarts the store application to refresh the existing in-memory config cache.
- PPN is calculated after discount:

  ```text
  taxableBase = max(0, subtotal - discount)
  ```

- PPN is rounded upward to a whole Rupiah:

  ```text
  ppnAmount = ceil(taxableBase × ppnRatePercent / 100)
  ```

- Example: a raw result of `100000.21` becomes `100001`.
- An already-whole result remains unchanged.
- Final total:

  ```text
  total = taxableBase + shippingCost + serviceFee + ppnAmount
  ```

- Each order stores its PPN rate and amount as an immutable pricing snapshot.
- Re-payment uses the order snapshot, not the current global configuration.

---

## 3. Research Findings

### 3.1 Existing WhatsApp/footer infrastructure

The footer CMS already supports WhatsApp:

- Footer schema and types: `packages/db/src/schema/footer.ts`
- Admin form: `apps/admin/src/components/admin/FooterForm.tsx`
- Footer validation: `apps/admin/src/lib/footer-config.ts`
- WhatsApp SVG icon: `packages/ui/src/components/footer/SocialIcons.tsx`
- Store config loader: `apps/store/src/components/FooterWrapper.tsx`
- Shared footer renderer: `packages/ui/src/components/footer/Footer.tsx`
- Existing CMS E2E coverage: `e2e/admin/cms.spec.ts`

Therefore, no new WhatsApp table or endpoint is required. The floating button can consume the existing enabled WhatsApp social-media entry.

### 3.2 Confirmed password-reset root cause

A temporary Playwright reproduction was run through the real admin UI. Generated-password mode sent:

```json
{
  "passwordMode": "generate",
  "password": ""
}
```

The route returned HTTP 400:

```json
{
  "success": false,
  "error": "Invalid request body",
  "details": {
    "password": ["Password minimal 8 karakter"]
  }
}
```

Root cause:

- `ResetPasswordDialog.tsx` always passes its password state to `onConfirm`.
- The initial password state is an empty string.
- The API schema uses `z.string().min(8).optional()`.
- Zod `optional()` accepts `undefined`, but an explicitly supplied empty string still fails `.min(8)`.

Affected flow:

- `apps/admin/src/components/admin/ResetPasswordDialog.tsx`
- `apps/admin/src/app/admin/users/page.tsx`
- `apps/admin/src/app/api/admin/users/[id]/reset-password/route.ts`

Better Auth has an admin plugin with `setUserPassword` and `revokeUserSessions`, but this application currently uses its own RBAC and reset endpoint. Migrating authentication architecture is unnecessary for this targeted fix.

### 3.3 Existing order pricing flow

Current order creation uses:

```text
serviceFee = 0
total = subtotal
```

Primary files:

- `apps/store/src/app/api/checkout/place-order/route.ts`
- `apps/store/src/app/checkout/page.tsx`
- `apps/store/src/app/api/payments/midtrans/create/route.ts`
- `packages/db/src/schema/orders.ts`

Existing system configuration infrastructure:

- Schema: `packages/db/src/schema/system.ts`
- Cached reader: `apps/store/src/lib/config.ts`
- Seed data: `packages/db/src/seed.ts`

Midtrans requires `gross_amount` to match the sum of `item_details`. Adding PPN only to the total without adding a corresponding payment line item would create an inconsistent transaction payload.

---

## 4. Delivery Strategy

Implement in three isolated vertical slices:

1. Admin password-reset bug fix.
2. Configurable floating WhatsApp button.
3. Configurable PPN throughout checkout and order history.

For each slice:

1. Write a failing test at an approved public seam.
2. Run it and confirm the expected failure.
3. Implement the smallest production change.
4. Run the focused test until green.
5. Run relevant regression tests.
6. Update documentation in the same slice.

Do not combine unrelated refactors with these changes.

---

# Slice A — Fix Admin Password Reset

## A.1 Public test seams

- User-visible admin flow through `/admin/users`.
- HTTP contract of `POST /api/admin/users/{id}/reset-password`.
- Login behavior of the reset target using the newly generated password.

Tests should not assert private component state or private helper calls.

## A.2 Tests first

Create `e2e/admin/users.spec.ts` with an isolated admin-user fixture.

Generated-password scenario:

1. Create a dedicated target admin fixture.
2. Login as HQ.
3. Open `/admin/users`.
4. Open the target user's action menu.
5. Select **Reset Password**.
6. Keep **Generate Otomatis** selected.
7. Submit the dialog.
8. Assert the request succeeds instead of returning HTTP 400.
9. Assert the one-time credentials dialog displays a generated password.
10. Use a fresh browser context to login as the target user with that password.
11. Assert the target is sent to the forced password-reset flow.
12. Clean up fixture sessions, accounts, and user records.

Add focused unit coverage for the request/schema contract:

- Generated mode does not include a password.
- Manual mode requires a password.
- Manual mode accepts a valid password.
- Manual mode rejects a missing or short password.

## A.3 UI request fix

Update `apps/admin/src/components/admin/ResetPasswordDialog.tsx` so generated mode passes `undefined`:

```ts
onConfirm(
  passwordMode,
  passwordMode === "manual" ? password : undefined
);
```

Update `apps/admin/src/app/admin/users/page.tsx` to construct the request body conditionally:

```ts
const payload =
  passwordMode === "manual"
    ? { passwordMode, password }
    : { passwordMode };
```

This gives defense at both UI boundaries and ensures generated mode sends exactly:

```json
{ "passwordMode": "generate" }
```

## A.4 Server validation

Replace the permissive object schema in
`apps/admin/src/app/api/admin/users/[id]/reset-password/route.ts` with an explicit discriminated union:

```ts
z.discriminatedUnion("passwordMode", [
  z.object({
    passwordMode: z.literal("generate")
  }),
  z.object({
    passwordMode: z.literal("manual"),
    password: z.string().min(8)
  })
]);
```

Retain the current behavior:

- hash with the password hasher compatible with the admin Better Auth instance;
- update or create the credential account;
- set `mustResetPassword = true`;
- revoke all sessions for the target user;
- return plaintext only once in the successful response.

Never log or persist the plaintext password.

## A.5 Structured logging

Replace direct `console.error` usage in the changed route with the admin structured logger.

Minimum events:

- warning: invalid request, with validation field names but no password value;
- warning: target user not found;
- info: successful reset, with actor ID, target user ID, and password mode;
- error: unexpected failure, with actor/target context and serialized error.

## A.6 Documentation

Update:

- `docs/api-reference.md`
- `docs/architecture/auth.md`
- `docs/testing/README.md`

Document the mode-specific body contract and permanent E2E coverage.

## A.7 Acceptance criteria

- Generated mode no longer returns `Invalid request body`.
- Manual mode still validates its password.
- Generated password can authenticate the target user.
- Existing target sessions are revoked.
- Forced password reset remains enabled.
- No plaintext password appears in application logs.

---

# Slice B — Configurable Floating WhatsApp Button

## B.1 Public test seams

- Admin footer configuration UI.
- Rendered storefront anchor accessible by role/name.
- Saved footer configuration HTTP contract only if its validation behavior changes.

## B.2 Tests first

Extend `e2e/admin/cms.spec.ts`:

1. Preserve the complete original footer JSON before mutation.
2. Login as HQ and open `/admin/footer`.
3. Enable WhatsApp.
4. Enter a test `https://wa.me/...` URL.
5. Save successfully.
6. Open a storefront page.
7. Assert a floating link named for WhatsApp is visible.
8. Assert its `href` equals the saved URL.
9. Disable WhatsApp and assert the floating button is absent.
10. Restore the complete original footer JSON during cleanup.

Extend `apps/admin/src/lib/footer-config.test.ts` if WhatsApp URL validation is tightened.

Add a unit test for the public URL-selection helper if one is extracted:

- returns the enabled HTTP(S) WhatsApp URL;
- returns null for disabled, empty, malformed, or non-HTTP(S) values.

## B.3 Shared floating component

Create:

```text
packages/ui/src/components/footer/FloatingWhatsappButton.tsx
```

Export it from:

```text
packages/ui/src/index.ts
```

Required behavior:

- render a fixed button in the bottom-right corner;
- use the existing WhatsApp SVG from `SocialIcons.tsx`;
- use WhatsApp visual styling while remaining consistent with the storefront;
- use a minimum 48–56 px touch target;
- include keyboard-visible focus styling;
- account for mobile safe-area spacing;
- use a sufficiently high z-index without covering dialogs;
- include an accessible name such as `Hubungi ADF Sports melalui WhatsApp`;
- open in a new tab with `target="_blank"` and `rel="noopener noreferrer"`.

## B.4 Store integration

Update `apps/store/src/components/FooterWrapper.tsx`:

1. Fetch footer configuration once as it does today.
2. Render the standard footer.
3. Find the enabled WhatsApp entry with a non-empty safe HTTP(S) URL.
4. Render `FloatingWhatsappButton` with that URL.

Do not put the floating button directly inside the shared `Footer` component. This prevents the fixed button from unexpectedly appearing over the admin footer preview dialog.

## B.5 Seeder

Update `packages/db/src/seed.ts` to add:

```json
{
  "platform": "whatsapp",
  "url": "https://wa.me/6281234567890",
  "enabled": true
}
```

Update `DEFAULT_FOOTER_CONFIG` in `packages/db/src/schema/footer.ts` to keep the documented fallback/default shape aligned with seed data.

No database migration is required because WhatsApp already belongs to the existing JSONB configuration schema.

## B.6 Validation and safety

An enabled floating WhatsApp URL must use `http:` or `https:`. This allows both common formats:

```text
https://wa.me/<number>
https://api.whatsapp.com/send?phone=<number>
```

Do not append a prefilled message.

Avoid rendering malformed or non-HTTP(S) values as clickable floating links.

## B.7 Documentation

Update:

- `docs/features/footer.md`
- `docs/api-reference.md` only if footer validation changes
- `docs/testing/README.md`

## B.8 Acceptance criteria

- Seeded storefront shows the WhatsApp floating button.
- HQ can change the URL through `/admin/footer` without deployment.
- Saving the new URL updates the storefront.
- Disabling WhatsApp removes both the footer WhatsApp icon and floating button.
- The button is accessible on desktop and mobile.
- No new endpoint or environment variable is introduced.

---

# Slice C — Configurable PPN After Discount

## C.1 Public test seams

- Pure order-pricing calculation API.
- Cart API pricing configuration response.
- Store checkout UI.
- `POST /api/checkout/place-order` observable response and persisted order result.
- Midtrans payment payload builder.
- Customer and admin order-detail UI.
- Customer order emails.

Tests must use worked examples from this specification rather than reimplementing the production formula in assertions.

## C.2 Exact monetary arithmetic

Do not calculate PPN with an unguarded binary floating-point expression such as:

```ts
Math.ceil(subtotal * rate / 100)
```

A mathematically whole result can become `11000.000000000002` in floating-point and incorrectly round to `11001`.

Implement decimal-safe fixed-point arithmetic. Recommended approach:

- parse monetary values as fixed two-decimal units;
- parse the percentage into a fixed precision integer;
- perform multiplication and ceiling division with integer/`BigInt` arithmetic;
- return DB-compatible decimal strings and UI-compatible whole-Rupiah values.

The helper must make the upward-rounding rule explicit and deterministic.

## C.3 Pricing helper and unit tests

Create:

```text
apps/store/src/lib/order-pricing.ts
apps/store/src/lib/order-pricing.test.ts
```

Suggested public result:

```ts
{
  subtotal,
  discount,
  taxableBase,
  shippingCost,
  serviceFee,
  ppnRatePercent,
  ppnAmount,
  total
}
```

Write tests before implementation for at least:

1. `100000` at 11% → PPN `11000`, total `111000`.
2. PPN raw result `100000.21` → PPN `100001`.
3. A whole raw PPN result is not incremented.
4. PPN is calculated after discount.
5. Discount equal to subtotal produces zero taxable base and zero PPN.
6. Discount above subtotal is clamped to zero taxable base.
7. Zero percent produces zero PPN.
8. Decimal rates are deterministic if IT supplies one.
9. Invalid or out-of-range configured rates resolve to the fallback 11%.

## C.4 System configuration

Update known-key documentation in:

- `packages/db/src/schema/system.ts`
- `apps/store/src/lib/config.ts`

Add to `packages/db/src/seed.ts`:

```text
key: tax.ppnRatePercent
value: 11
type: number
```

Suggested description:

```text
Customer PPN percentage. Applied after discounts and rounded upward to a whole Rupiah. Restart the store application after changing this value.
```

Use an application fallback of 11%.

Validate the loaded rate:

- finite decimal;
- minimum 0;
- maximum 100.

An invalid value must use 11% and produce a structured warning. The application must not silently charge a negative or excessive rate.

Operational SQL example:

```sql
UPDATE system_config
SET value = '12', updated_at = NOW()
WHERE key = 'tax.ppnRatePercent';
```

Restart the store service after injection because the existing config reader caches values for the process lifetime.

## C.5 Order schema and migration

Update only:

```text
packages/db/src/schema/orders.ts
```

Add immutable order snapshot columns:

```text
ppn_rate    numeric, not null, default 0
ppn_amount  numeric(15,2), not null, default 0
```

Use sufficient precision for a decimal percentage and add checks:

```text
0 <= ppn_rate <= 100
ppn_amount >= 0
```

Update the existing order amount check to include `ppn_amount`.

Generate and apply through the root scripts:

```bash
npm run db:generate
npm run db:push
```

Do not use `db:migrate` in the development database.

The generated SQL under `packages/db/drizzle/` must be committed as the migration audit record.

## C.6 Seeder alignment

Update all seeded orders in `packages/db/src/seed.ts`:

- read/use the seeded 11% policy consistently;
- calculate PPN after discount;
- store `ppnRate` and `ppnAmount`;
- set total to the new gross amount.

Keep `seedCleanupEntries` unchanged unless a new table is introduced; the plan does not require a new table.

Ensure seeded footer WhatsApp and PPN configuration are both present after `db:reset && db:seed`.

## C.7 Cart pricing contract

Update `GET /api/cart` to expose the effective PPN rate needed by cart and checkout UI, for example:

```json
{
  "success": true,
  "data": {
    "items": [],
    "subtotal": 0,
    "ppnRatePercent": 11
  }
}
```

The UI may calculate a preview from selected items, but `place-order` remains authoritative and recalculates all amounts from server-side item prices.

Update all affected client response types in:

- `apps/store/src/app/cart/page.tsx`
- `apps/store/src/app/checkout/page.tsx`
- any shared cart type introduced during implementation

Because `/api/cart` is a changed backend route, add structured success/failure logging according to project rules.

## C.8 Authoritative order creation

Update:

```text
apps/store/src/app/api/checkout/place-order/route.ts
```

Flow:

1. Load selected cart items and prices from the database.
2. Calculate subtotal server-side.
3. Resolve the effective PPN rate with fallback and range validation.
4. Apply any persisted discount before PPN; current checkout discount remains zero until voucher redemption is implemented.
5. Calculate decimal-safe PPN with upward whole-Rupiah rounding.
6. Calculate final total.
7. Persist `subtotal`, `discount`, `ppnRate`, `ppnAmount`, `shippingCost`, `serviceFee`, and `total` in one order snapshot.
8. Log rate, PPN amount, and total with the order ID.

The client must never be trusted to submit a PPN amount or final total.

## C.9 Midtrans payload consistency

Extract a shared payment item-details builder or equivalent public helper so initial payment and re-payment use identical composition.

The payload must include product lines plus explicit non-product amounts when non-zero:

```json
{
  "id": "PPN",
  "name": "PPN 11%",
  "price": 11000,
  "quantity": 1
}
```

Relevant files:

- `apps/store/src/app/api/checkout/place-order/route.ts`
- `apps/store/src/app/api/payments/midtrans/create/route.ts`
- optionally a new focused helper under `apps/store/src/lib/`

Required invariant:

```text
sum(item_details.price × item_details.quantity) = gross_amount = orders.total
```

Re-payment must use:

- stored order items;
- stored `ppnRate`;
- stored `ppnAmount`;
- stored service/shipping/discount amounts as applicable;
- stored order total.

It must not read the current `tax.ppnRatePercent` value.

Add unit tests with literal expected line items and gross totals.

## C.10 Webhook and payment lifecycle

The Midtrans webhook already compares provider amounts against `orders.total`. Once `orders.total` includes PPN, the existing verification remains conceptually valid.

Regression-test:

- valid callback with gross total including PPN succeeds;
- mismatched amount is rejected;
- late settlement and reservation compensation paths remain unaffected;
- re-payment preserves the original PPN snapshot.

Do not change stock quantities or Jubelio adjustment values based on PPN. Tax affects payment/accounting amounts only, not inventory.

## C.11 UI breakdown

Display PPN consistently in:

- `apps/store/src/app/cart/page.tsx`
- `apps/store/src/app/checkout/page.tsx`
- `apps/store/src/app/account/orders/[id]/page.tsx`
- `apps/admin/src/app/admin/orders/[id]/page.tsx`

Target breakdown:

```text
Subtotal
Discount
PPN (11%)
Shipping
Service Fee
Total Payment
```

Zero-value rows may follow the current UI style, but PPN must be visible during checkout and in historical order details. Historical pages must label PPN using the order's stored rate.

Order-list pages already show `orders.total`; they do not require a new column unless product review requests one.

## C.12 Order API types and selectors

Update explicit selectors/interfaces that currently include subtotal/service fee but not PPN:

- `apps/admin/src/app/api/admin/orders/[id]/route.ts`
- `apps/admin/src/app/admin/orders/[id]/page.tsx`
- `apps/store/src/app/account/orders/[id]/page.tsx`
- `apps/store/src/app/account/page.tsx` if its local order type needs the new fields

Store order APIs that spread the complete `orders` row will expose the new columns automatically, but their documented response contracts and frontend types still need updating.

Every changed API route must retain or gain structured success/error logging.

## C.13 Emails

Update:

```text
apps/store/src/lib/email-templates-order.ts
```

Extend `OrderForEmail` with:

```text
ppnRate
ppnAmount
```

Show PPN in both HTML and plain-text versions of:

- pickup-ready email;
- order-completed email;
- payment-failed email if it contains the payment breakdown.

Update callers in:

- `apps/store/src/lib/order-finalize.ts`
- `apps/store/src/lib/paid-order-side-effects.ts`
- `apps/store/src/app/api/internal/order-complete/route.ts`

Add or extend template unit tests with literal expected PPN labels and amounts.

## C.14 Analytics

`apps/admin/src/app/api/admin/analytics/route.ts` sums `orders.total`, so revenue will naturally become gross revenue including PPN.

Document that behavior explicitly. No net-revenue or separate tax-reporting metric is included in this scope.

## C.15 E2E coverage

Extend `e2e/store/checkout.spec.ts` with deterministic fixtures and cleanup.

Scenarios:

1. Cart/checkout displays `PPN (11%)`.
2. Displayed PPN matches a known worked example.
3. Displayed total equals subtotal after discount plus PPN and other charges.
4. Placed order stores the expected `ppn_rate`, `ppn_amount`, and `total`.
5. PPN is rounded upward for a fractional result.
6. Payment boundary receives the gross amount including PPN.
7. Re-payment uses the original order PPN after the global config fixture is changed.
8. Existing reservation, failure, and late-settlement tests remain green.

Extend admin order E2E coverage:

- order detail displays stored PPN rate and amount;
- displayed total matches the stored order snapshot.

Any direct database access in E2E should be limited to deterministic fixture setup/cleanup and verifying persisted integration results that cannot be observed through an existing public response.

## C.16 Documentation

Create:

```text
docs/features/ppn.md
```

Update:

- `docs/api-reference.md`
- `docs/features/order-flow.md`
- `docs/features/pricing-model.md`
- `docs/features/analytics.md`
- `docs/features/seeding.md`
- `docs/architecture/database.md`
- `docs/testing/README.md`

Document:

- config key and fallback;
- restart requirement;
- after-discount taxable base;
- upward whole-Rupiah rounding;
- order snapshot fields;
- Midtrans line-item invariant;
- re-payment snapshot behavior;
- gross-revenue analytics behavior;
- SQL update example.

No deployment environment-variable change is required.

## C.17 Acceptance criteria

- New orders use 11% PPN by default.
- IT can change the rate through `system_config` and restart the store service.
- PPN is calculated after discount.
- Fractional PPN always rounds upward to the next whole Rupiah.
- Whole PPN values are not incremented.
- Order history retains the original rate and amount after configuration changes.
- Initial payment and re-payment use matching gross amounts and item details.
- Checkout, customer order detail, admin order detail, and emails show PPN.
- Stock reservation behavior remains unchanged.
- Analytics revenue continues to represent gross paid order totals, now including PPN.

---

## 5. Files Expected to Change

### Database package

- `packages/db/src/schema/footer.ts`
- `packages/db/src/schema/system.ts`
- `packages/db/src/schema/orders.ts`
- `packages/db/src/seed.ts`
- generated migration under `packages/db/drizzle/`

### Shared UI

- `packages/ui/src/components/footer/FloatingWhatsappButton.tsx` — new
- `packages/ui/src/index.ts`

### Store application

- `apps/store/src/components/FooterWrapper.tsx`
- `apps/store/src/lib/order-pricing.ts` — new
- `apps/store/src/lib/order-pricing.test.ts` — new
- possible payment item-details helper and test under `apps/store/src/lib/`
- `apps/store/src/lib/config.ts`
- `apps/store/src/lib/email-templates-order.ts`
- `apps/store/src/lib/order-finalize.ts`
- `apps/store/src/lib/paid-order-side-effects.ts`
- `apps/store/src/app/api/cart/route.ts`
- `apps/store/src/app/api/checkout/place-order/route.ts`
- `apps/store/src/app/api/payments/midtrans/create/route.ts`
- `apps/store/src/app/api/internal/order-complete/route.ts`
- `apps/store/src/app/cart/page.tsx`
- `apps/store/src/app/checkout/page.tsx`
- `apps/store/src/app/account/orders/[id]/page.tsx`
- related local types/tests as discovered during implementation

### Admin application

- `apps/admin/src/components/admin/ResetPasswordDialog.tsx`
- `apps/admin/src/app/admin/users/page.tsx`
- `apps/admin/src/app/api/admin/users/[id]/reset-password/route.ts`
- `apps/admin/src/lib/footer-config.ts` if URL validation changes
- `apps/admin/src/lib/footer-config.test.ts`
- `apps/admin/src/app/api/admin/orders/[id]/route.ts`
- `apps/admin/src/app/admin/orders/[id]/page.tsx`

### E2E

- `e2e/admin/users.spec.ts` — new
- `e2e/admin/cms.spec.ts`
- `e2e/admin/orders.spec.ts`
- `e2e/store/checkout.spec.ts`

### Documentation

- `docs/features/ppn.md` — new
- `docs/features/footer.md`
- `docs/features/order-flow.md`
- `docs/features/pricing-model.md`
- `docs/features/analytics.md`
- `docs/features/seeding.md`
- `docs/api-reference.md`
- `docs/architecture/auth.md`
- `docs/architecture/database.md`
- `docs/testing/README.md`

The exact set may be reduced if an existing spread/type already carries the new fields without a source change.

---

## 6. Verification Commands

Run focused tests during each TDD cycle, then execute the complete relevant suites from the repository root:

```bash
npm run test:unit
npm run test:e2e
npm run lint
npm run build
```

For schema work:

```bash
npm run db:generate
npm run db:push
```

For seed verification in a disposable development database:

```bash
npm run db:reset
npm run db:seed
```

Verify that `git status` contains only intentional source, test, migration, and documentation changes before completion.

When diagnosing Playwright failures, read the generated Markdown error context and do not open screenshot attachments.

---

## 7. Out of Scope

- Admin UI for editing the PPN rate.
- Prefilled WhatsApp messages.
- Multiple WhatsApp destinations per branch.
- Voucher redemption implementation; only the approved after-discount PPN formula is made compatible with a future persisted discount.
- Tax invoices or formal Indonesian e-Faktur integration.
- Separate net-revenue and collected-tax analytics reports.
- Changing the existing Better Auth architecture to the Better Auth admin plugin.
- Inventory/Jubelio changes caused by tax amounts.
