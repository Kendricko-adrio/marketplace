# Admin Customer Directory

## Purpose

The Customer module gives authorized admin users a read-only directory of all
storefront accounts. It separates storefront customers (`client`) from admin
staff (`user`) and must never use the admin Better Auth user table as its data
source.

## Routes

| Route | Purpose |
|---|---|
| `/admin/customers` | Lists all registered customers and supports local search by name, email, or phone. |
| `/admin/customers/[id]` | Shows a customer profile, summary metrics, and complete order history. |

Both routes are Server Components that query PostgreSQL directly through the
admin app's database instance. No customer-directory HTTP endpoint is exposed.

## List Data

The list includes `name`, `email`, `phone`, `birth_date`, `gender`,
`onboarding_completed`, `created_at`, and `updated_at`. It also shows an order
count for operational context. Nullable onboarding fields render as an em dash.

## Customer Detail and Order History

The detail page shows the registration/onboarding profile, email verification
state, total order count, completed order count, and total value of paid orders.
Its order history contains the order ID, creation date, branch, item count,
total, and status. Each history row links to the existing admin order detail
route, where the normal Order-module permission and branch-scope rules still
apply.

## Access Control

`customers` is an RBAC module. HQ has implicit full access. The default seeded
Admin role has no Customer access, so the sidebar item is hidden and direct
route access redirects to the first permitted admin module. HQ can explicitly
grant access from the Hak Akses page. Migration
`0014_add_customers_permission.sql` adds the same disabled default to existing
databases without overwriting an existing Customer permission row.

The directory is global: an authorized user sees all registered storefront
customers and their full order history. The module does not provide edit or
delete operations.
