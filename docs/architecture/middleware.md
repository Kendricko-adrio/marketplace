# Middleware — Route Protection per App

Deep-dive companion to AGENTS.md §1/§4. Each app has its own
`src/middleware.ts`. Both read the session cookie via Better Auth's
`getSessionCookie` helper (handles the `__Secure-` cookie prefix).

## Store (`apps/store/src/middleware.ts`)

| Behavior | Routes |
|---|---|
| Require authentication | `/cart`, `/checkout`, `/account` → redirect to `/login?callbackUrl=` |
| Redirect when already logged in | `/login`, `/register` |
| Onboarding gate | Logged-in users without the `client.onboarding=1` cookie are redirected to `/onboarding`, except for a bypass list |

Onboarding-gate bypass list:
- Prefixes: `/onboarding`, `/auth/verify`, `/api/auth`, `/api/onboarding`,
  `/forgot-password`, `/reset-password`
- Exact: `/logout`

## Admin (`apps/admin/src/middleware.ts`)

| Behavior | Routes |
|---|---|
| Require authentication | `/admin/*` → redirect to `/login?callbackUrl=` |
| Redirect when already logged in | `/login` |
| `mustResetPassword` gate | Authenticated users forced to change their password may only visit the bypass list |

Password-reset-gate bypass prefixes: `/reset-password`, `/api/auth`,
`/api/admin/users` (lets HQ keep managing users mid-session, defensive),
`/logout`.

## See Also

- [auth.md](auth.md) — the two Better Auth instances these gates rely on
- [../features/onboarding.md](../features/onboarding.md) — onboarding flow
