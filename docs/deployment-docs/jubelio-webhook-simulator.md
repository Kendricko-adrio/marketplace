# Jubelio Webhook Simulator

The simulator sends a webhook that is shaped like a real Jubelio event while
using live Jubelio catalog data. It only reads from Jubelio (`POST /login`,
`GET /inventory/items/masters`, and, for `update-qty`,
`POST /inventory/items/all-stocks/`). The write is sent to the configured local
or staging webhook endpoint, not back to Jubelio.

## Configuration

Use the same `.env` values as the store:

```text
JUBELIO_API_BASE_URL=https://api2.jubelio.com
JUBELIO_EMAIL=your-jubelio-email
JUBELIO_PASSWORD=your-jubelio-password
JUBELIO_WEBHOOK_SECRET=the-secret-used-by-the-store-webhook
JUBELIO_WEBHOOK_URL=http://localhost:3000/api/webhooks/jubelio
```

The simulator loads environment variables from the shell. It does not print
the login password or API token.

## Usage

From the repository root:

```bash
# Preview the selected payload without calling the webhook
npm run jubelio:webhook -- --dry-run

# Choose a specific event type
npm run jubelio:webhook -- --action=update-product
npm run jubelio:webhook -- --action=update-price
npm run jubelio:webhook -- --action=update-qty

# Use a smaller page size when testing pagination
npm run jubelio:webhook -- --page-size=25
```

Without `--action`, the simulator randomly chooses one of the three supported
actions. It first reads the total number of master products, selects a random
page and product, then builds the minimal payload expected by
`POST /api/webhooks/jubelio`. The request body is signed using the same
`SHA256(rawBody + JUBELIO_WEBHOOK_SECRET)` rule as the route.

`update-qty` also reads the selected product's stock locations so that its
`item_ids` and `location_id` are real values. The simulator never calls
Jubelio's inventory-adjustment write endpoint.

## Safety

- Prefer `--dry-run` while validating credentials and payload shape.
- Point `JUBELIO_WEBHOOK_URL` at a development or staging store first.
- Keep production credentials out of shell history and CI logs.
- A non-2xx webhook response makes the command fail so the response body can
  be investigated.
