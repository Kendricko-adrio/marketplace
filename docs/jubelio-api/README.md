# Jubelio API Spec (`dist.yaml`)

`dist.yaml` is the OpenAPI specification of the Jubelio API
(`https://api2.jubelio.com`), exported from Jubelio's API documentation. It is
the reference for the sync implementation in
`packages/db/src/jubelio-sync.ts` (see `docs/features/jubelio-sync.md` for the full
sync design).

## How to use

- **Import into an API client** — Postman, Insomnia, or Stoplight can import
  `dist.yaml` directly to browse endpoints and try requests.
- **Read it directly** — the file is plain YAML; search for a path (e.g.
  `/inventory/items/masters`) to see its parameters and response schema.

## Most relevant endpoints for sync

| Endpoint | Used for |
|---|---|
| `POST /login` | Auth — `{email, password}` → `{token}` (12h expiry) |
| `GET /inventory/items/masters` | Paginated product master list (item groups + items) |
| `GET /inventory/catalog/{id}` | Per-item-group detail: description, `images[]` gallery |
| `POST /inventory/items/all-stocks/` | Per-location stock for all items |
| `GET /locations/list` | All outlet locations (branches) — NOT `/locations/`, which returns only the webstore |

## Caveat: spec vs. live behavior

This spec is an **external reference** and may drift from the actual API
behavior. If the spec and the live API disagree, the code in
`packages/db/src/jubelio-sync.ts` is the source of truth — it has been
verified against the live API.

## Related docs

- `docs/features/jubelio-sync.md` — sync architecture, invariants, env vars, webhook setup
