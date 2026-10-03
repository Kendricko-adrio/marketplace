# Shipment readiness

Store callback requires dedicated `JUBELIO_SHIPMENT_WEBHOOK_SECRET` (blank returns 503; no API/Omnichannel fallback). Owner configures the Shipment dashboard callback to `https://<store-domain>/api/webhooks/jubelio-shipment` with the matching secret. No dashboard registration, deployment or real callback test has been performed by the agent. Independent HMAC/mock HTTP verification does not claim operational activation.

Staging/production Compose passes these server-only variables to store (quotes) and admin (packing/booking):

- `JUBELIO_SHIPMENT_URL` (HTTPS Shipment host, separate from Omnichannel)
- `JUBELIO_SHIPMENT_CLIENT_ID`
- `JUBELIO_SHIPMENT_CLIENT_SECRET`
- Admin additionally receives `JUBELIO_SHIPMENT_TIMEOUT_MS` (default 10000 ms; timeout after dispatch never authorizes a retry).

Use independent Shipment credentials. Empty credentials fail closed; they never reuse `JUBELIO_EMAIL/PASSWORD`. Never enable `E2E_PROVIDER_MOCKS` or point production at a loopback mock. The application rejects E2E mode when APP_ENV or NODE_ENV is production.

Before operational activation, configure each eligible branch's local shipping phone/address/postcode (optional Shipment area ID) through the existing Branch form. Verify per-SKU master grams/cm after catalog sync. IT must configure a measured fallback block if necessary and explicit packaging grams in `system_config`; see [origin and parcel configuration](../features/client-addresses.md#branch-origin-and-per-sku-parcels). Parcel parameters are re-read per quote; the general PPN rate remains process-cached.

Generate/review migrations in development and use the existing authorized deployment migration process for schema changes. Do not run dev db:push on production. Local mock verification is not permission to deploy or perform real Shipment authentication/rates/booking requests. Quote tests use only isolated local endpoints; no live courier activation has been verified.

Quote readiness does not complete the delivery lifecycle. Order/payment, packing/booking, signed tracking and operational follow-up must also be verified before launch.
