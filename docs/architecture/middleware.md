# Proxy and Server-Side Route Protection

Deep-dive companion to AGENTS.md §1/§4. Each app uses `src/proxy.ts`, the
Next.js 16 convention. A proxy session-cookie check is only an early redirect
optimization; cookies are never treated as authorization. Protected layouts
and API handlers verify the Better Auth session and database state again.

## Store (`apps/store/src/proxy.ts`)

| Layer | Behavior |
|---|---|
| Proxy | Guests requesting `/cart`, `/checkout`, or `/account` are redirected to `/login?callbackUrl=` |
| Protected layouts | Load the server session and require `clients.onboardingCompleted === true` |
| Protected APIs | Return 401 without a client session and 403 when onboarding is incomplete |

The `callbackUrl` carries the **pathname and its query** (`pathname + search`),
so a customer who hits `/checkout/result?order_id=…` while signed out returns
to that same result page after signing in instead of losing the order
identity. The value stays an internal path; `apps/store/src/lib/safe-redirect.ts`
still rejects external, protocol-relative and non-http(s) callbacks, and the
onboarding gate is never bypassed to reach the result page. Both the email flow
and the Google flow pass the same safe callback through
`/api/onboarding/sync` (new Google users still land on `/onboarding`).

The `client.onboarding` cookie may still be synchronized for UX compatibility,
but it cannot grant access. Missing, false, or null database state is denied.

## Admin (`apps/admin/src/proxy.ts`)

| Layer | Behavior |
|---|---|
| Proxy | Guests requesting `/admin/*` are redirected to `/login?callbackUrl=` |
| Admin layout | Verifies the server session, enforces forced password reset, and rejects branch admins without an assigned branch |
| API wrappers | Apply the same reset/branch invariants before role and permission checks |

The forced-password-reset flag is read from the authenticated server session,
not a client-writable cookie. HQ users may operate across branches; branch
admins are always scoped to their assigned branch.

## See Also

- [auth.md](auth.md) — the two independent Better Auth instances
- [../features/onboarding.md](../features/onboarding.md) — onboarding flow
