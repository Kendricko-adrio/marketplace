# Authentication — Two Better Auth Instances

Deep-dive companion to AGENTS.md §1/§4. The store and admin run **independent**
Better Auth instances with different user tables, cookie prefixes, and feature
sets. They must never be treated as interchangeable.

## Comparison

| Aspect | Store (`apps/store/src/lib/auth.ts`) | Admin (`apps/admin/src/lib/auth.ts`) |
|---|---|---|
| Cookie prefix | `client` (e.g. `client.session_token`) | `admin` (e.g. `admin.session_token`) |
| User table | `clients` (no `role` field) | `users` (has `role` column) |
| Session table | `clientSessions` | `adminSessions` |
| Account table | `clientAccounts` | `adminAccounts` |
| Verification table | `clientVerifications` | `adminVerifications` |
| Social login | Google OAuth | none |
| Email verification | Required (`sendOnSignUp: true`, 1h expiry) | not configured |
| Username plugin | no | yes (`better-auth/plugins` `username`) |
| Onboarding gate | yes (`onboardingCompleted` + server layouts/API guards) | no |
| Extra user fields | phone, birthDate, gender, onboardingCompleted | role (`admin` \| `hq`, default `admin`, `input:false`) |

## Shared Behavior

- Both instances use the Drizzle adapter with `provider: "pg"` and `bcryptjs`
  hashing.
- Session lifetime: 7 days, `updateAge` 1 day (both apps).
- Cross-app protection: each instance's `session.create.before` hook rejects
  users of the wrong type (admin trying to sign in on store, or vice versa) by
  throwing `APIError("FORBIDDEN", { code: "INVALID_USER_TYPE" })`.
- Better Auth catch-all route: `apps/store/src/app/api/auth/[...all]/route.ts`
  and `apps/admin/src/app/api/auth/[...all]/route.ts`.

## Roles

- **Admin roles** (column on `users` table): `admin` | `hq` (default `admin`).
  The role field is `input: false` — cannot be set by clients at signup.
- **Store users (`clients`)** have NO role column; access control is handled by
  separate tables/instances, not a unified role enum.

## See Also

## Password and forced-reset hardening

- Both apps enforce the same password complexity policy at password entry
  points: at least eight characters with lowercase, uppercase, and a digit.
- Admin `mustResetPassword` is enforced by the server layout and API guard;
  client cookies cannot clear or bypass it.
- Better Auth clears the flag only after a successful reset/change-password
  hook and revokes sessions on password reset.
- Login callback URLs are restricted to safe same-app paths, preventing open
  redirects.

- [middleware.md](middleware.md) — how each app protects its routes
- [../features/onboarding.md](../features/onboarding.md) — store onboarding flow
- [../features/rbac.md](../features/rbac.md) — admin role-based access control
