# Jubelio API references

These are **two separate APIs**:

| Reference | Host | Scope |
|---|---|---|
| [`dist.yaml`](dist.yaml) | `https://api2.jubelio.com` | Omnichannel OpenAPI specification, exported from Jubelio's API documentation. Used as a reference for master-data sync in `packages/db/src/jubelio-sync.ts`. |
| [`shipment-v1.8.md`](shipment-v1.8.md) | `https://api-shipment.jubelio.com` (sandbox: `https://api-shipment.sandbox.jubelio.com`) | Shipment API contract from the supplied [`API Contract Jubelio Shipment v1.8.pdf`](../../API%20Contract%20Jubelio%20Shipment%20v1.8.pdf): regions, rates, AWB create/cancel/detail, and webhook. This is a documented contract, **not** a live-verified integration. |

Do not treat Shipment paths, credentials, or tokens as interchangeable with
Omnichannel's. See `docs/features/jubelio-sync.md` for the existing sync design.

## How to use

- **Omnichannel:** Import `dist.yaml` into Postman, Insomnia, or Stoplight, or
  search the YAML for a path such as `/inventory/items/masters`.
- **Shipment:** Read [`shipment-v1.8.md`](shipment-v1.8.md) for the PDF-derived
  API reference with page citations and explicit contract ambiguities. The PDF
  is not an importable OpenAPI specification.

## Most relevant endpoints for sync

| Endpoint | Used for |
|---|---|
| `POST /login` | Auth — `{email, password}` → `{token}` (12h expiry) |
| `GET /inventory/items/masters` | Paginated product master list (item groups + items) |
| `GET /inventory/catalog/{id}` | Per-item-group detail: description, `images[]` gallery |
| `POST /inventory/items/all-stocks/` | Per-location stock for all items |
| `GET /locations/list` | All outlet locations (branches) — NOT `/locations/`, which returns only the webstore |

## Caveat: spec vs. live behavior

`dist.yaml` is an **external reference** and may drift from actual Omnichannel
API behavior. If it and the live sync API disagree, the code in
`packages/db/src/jubelio-sync.ts` is the reference for behavior already
verified against the live API. The Shipment PDF has **not** been verified
against live Shipment endpoints in this repository.

## Related docs

- `docs/features/jubelio-sync.md` — Omnichannel sync architecture, invariants, env vars, webhook setup
- `docs/jubelio-api/shipment-v1.8.md` — Shipment-specific contract reference
