# Store Onboarding Flow

After signup, store customers must complete an identity step (phone, birth
date, gender) before they can use protected customer features. The database is
the source of truth: protected layouts and APIs verify session and onboarding
state on the server. The proxy cookie check is only an early redirect.

## Flow

```
signup (email+password | Google OAuth)
  → email verification (password signup only; Google is auto-verified)
  → /auth/verify landing page → redirects to /onboarding
  → /onboarding form (phone, birthDate, gender) → completeOnboarding action
  → sets client.onboarding=1 cookie + clients.onboardingCompleted=true
  → redirect "/" (home)
```

- **Password signup**: Better Auth `emailAndPassword` with
  `requireEmailVerification: true`, `sendOnSignUp: true`, 1h token expiry,
  `autoSignInAfterVerification: true`. A `before` hook enforces password
  complexity (8+ chars, lowercase + uppercase + digit) at
  `/sign-up/email` and `/reset-password`.
- **Google OAuth**: `databaseHooks.user.create.before` sets
  `emailVerified: true` and `onboardingCompleted: false` for
  `/callback/google` — Google users still must onboard.
- **Verify page** (`/auth/verify`): calls `authClient.verifyEmail` with
  `callbackURL` defaulting to `/onboarding`, then pushes there on success.

## Proxy and authoritative server gate

`apps/store/src/proxy.ts` redirects unauthenticated protected-page requests.
The `/cart`, `/checkout`, and `/account` server layouts and their APIs then
require a valid Better Auth session and
`clients.onboardingCompleted === true`.

| Rule | Behavior |
|---|---|
| Protected routes (`/cart`, `/checkout`, `/account`) without session | redirect `/login?callbackUrl={path}` |
| Authenticated, not onboarded, protected page | server redirect `/onboarding` |
| Authenticated, not onboarded, protected API | `403 Onboarding required` |

Authentication, verification, onboarding, password-reset, logout, and static
asset routes remain public or usable before onboarding is complete.

The session cookie is read with Better Auth's `getSessionCookie(request, {
cookiePrefix: "client" })` so the `__Secure-` prefix (auto-applied when
`BETTER_AUTH_URL` is https) is handled transparently. Only `cookiePrefix` is
passed — passing `cookieName` too would produce the wrong name
(`client-session_token` instead of `client.session_token`).

## Cookie mechanics

`client.onboarding` — a plain (non-httpOnly) cookie so the client can clear it
on logout; contains no sensitive data.

| Attribute | Value |
|---|---|
| Value | `"1"` when onboarding is complete |
| `httpOnly` | `false` |
| `sameSite` | `lax` |
| `secure` | `true` in production |
| `path` | `/` |
| `maxAge` | 7 days (matches session lifetime) |

Set in two places:

1. `completeOnboarding` server action (`apps/store/src/app/onboarding/actions.ts`)
   — after the DB update succeeds.
2. `GET /api/onboarding/sync` — when the DB says `onboardingCompleted` but the
   cookie is missing/expired.

## `/api/onboarding/sync`

`apps/store/src/app/api/onboarding/sync/route.ts` — syncs the edge cookie from
DB state, then redirects home. Used to break the **infinite redirect loop**:
if the cookie expired but the DB says onboarding is done, middleware would
bounce the user to `/onboarding`, and the page would bounce them back to `/`
(see below) — `/api/onboarding/sync` re-sets the cookie and redirects once.

- No session → 307 to `/login?callbackUrl=/onboarding`.
- Session + `onboardingCompleted` → sets `client.onboarding=1` (same
  attributes as above) and 307 to `/`.
- Session, not completed → 307 to `/onboarding` (no cookie).
- Session, completed → sets the cookie and redirects to a validated local
  `callbackUrl` (default `/`). Login always passes through this server route,
  so the post-login decision is based on database state rather than a cookie.
- Redirect origins use the configured public app URL (`BETTER_AUTH_URL` or
  `NEXT_PUBLIC_APP_URL`) instead of the request origin, which can resolve to
  the internal container bind address behind a reverse proxy.

The onboarding page itself (`apps/store/src/app/onboarding/page.tsx`) also
redirects to `/api/onboarding/sync` when the user is already onboarded but the
cookie is missing.

## Fields collected

`completeOnboarding` (`apps/store/src/app/onboarding/actions.ts`) validates
with zod, then updates `clients` and sets the cookie:

| Field | Column | Validation |
|---|---|---|
| phone | `clients.phone` (`text`) | regex `^\+62\d{8,13}$` — must start `+62`, no leading `0` |
| birthDate | `clients.birthDate` (`date`) | valid date **and** age ≥ 13 |
| gender | `clients.gender` (`text`) | enum `male` \| `female` |

The form (`apps/store/src/components/onboarding/identity-form.tsx`) normalizes
phone input client-side (strips leading `0`/`62` so the `+62` prefix is never
duplicated) and submits a hidden `phone` field with the full `+62…` value.

## Schema

`packages/db/src/schema/auth.ts` — `clients` table:

| Column | Notes |
|---|---|
| `phone` | `text`, nullable |
| `birthDate` | `date` (calendar date, no timezone — per project convention) |
| `gender` | `text`, nullable (`male` \| `female` \| `other`) |
| `onboardingCompleted` | `boolean` not null, default `false` |

Better Auth `additionalFields` (`apps/store/src/lib/auth.ts`) mirrors these
four fields; `onboardingCompleted` has `defaultValue: false`. The
`session.create.before` hook rejects non-client users (any user with a `role`
field) so admins cannot sign in on the store.

## Invariants (do NOT violate)

- **DB is the source of truth** — the cookie is only a UX cache and cannot
  authorize protected pages or APIs; `onboardingCompleted` in `clients`
  decides the real state.
- **Onboarding is store-only** — never assume a `role`/onboarding field on the
  admin `users` table (and vice versa).
- The cookie is **not httpOnly** by design (client clears it on logout) and
  must be read in middleware with the plain name `client.onboarding` (no
  `__Secure-` prefix).
- Google users are auto-verified but **still gated** by onboarding
  (`onboardingCompleted: false` on OAuth callback).
- `/api/onboarding/sync` must never set the cookie when
  `onboardingCompleted` is false — otherwise the gate would be bypassable.

## Verification

- `npm run dev:store` → register with email/password → verify email via the
  link → lands on `/onboarding`; submit the form → redirected to `/` and
  `client.onboarding=1` cookie is set.
- Logged-in, not onboarded: visiting `/cart`, `/checkout`, `/account`, or `/`
  redirects to `/onboarding`; visiting `/forgot-password` or `/logout` does
  not.
- Delete the `client.onboarding` cookie while `onboardingCompleted` is true →
  visiting `/` redirects to `/onboarding`, which bounces through
  `/api/onboarding/sync` and back home (no infinite loop).
- Google sign-in → straight to `/onboarding` (no email verification step).
- DB check: `clients` row has `phone`, `birth_date`, `gender`,
  `onboarding_completed = true` after the form is submitted.
