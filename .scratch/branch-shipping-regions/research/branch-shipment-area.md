# Branch Shipment area research

Status: research only; no behavior changes or implementation approval.

## Live primary-source observations

Requests used the configured production Omnichannel and Shipment hosts. Omnichannel authentication was authorized by the user following an explicit question about POST /login. No business-data writes, rate requests, or shipment bookings were made. Tokens, contact details, and street addresses are excluded from this note.

- `GET https://api2.jubelio.com/locations/list` returned HTTP 500 on two attempts. `GET /locations/` also returned 500. Enumeration of all current branches is therefore unverified.
- `GET https://api2.jubelio.com/locations/1` returned 200, including `province_id: "32"`, `city_id: "3215"`, `district_id: "321503"`, `subdistrict_id: "3215032002"`, province JAWA BARAT, city KAB. KARAWANG, `area: "Telukjambe Timur"`, `subdistrict: "Sukaharja"`, and `post_code: "41361"`. Address and phone are present but not reproduced.
- `GET https://api-shipment.jubelio.com/region/provinces` returned 200 with 34 provinces.
- `GET /region/cities/32` on the Shipment host returned city `3215`, KAB. KARAWANG.
- `GET /region/districts/3215` returned 200 with 30 districts.
- `GET /region/areas/321503` returned 200 with 9 areas, including `area_id: "3215032002"`, name Sukaharja, district `321503`, and `zipcode: "41360"`.
- `GET /regions?name=Sukaharja` on Shipment returned 11 results. The Karawang / Telukjambe Timur result confirms the same area ID and postcode. A name-only match would be ambiguous.
- `GET /regions?name=Tebet` returned 200 and includes district/city/province labels, area IDs, and postcodes.

## Conclusions and limits

For this sampled branch, Omnichannel `subdistrict_id` matches Shipment `area_id` after verification against the Shipment hierarchy. Omnichannel `area` means the district in this example, whereas Shipment `area` means the village. Do not map fields by their names alone, or assume all branches have equivalent/complete IDs.

The sample has a postcode mismatch: Omnichannel 41361 versus Shipment 41360. Silent auto-import is unsafe. Propose a verified suggestion with an explicit admin confirmation, using Shipment's canonical region data and postcode. This is a proposal, not an approved write or implementation contract.

Branch identity `jubelioLocationId` is distinct from delivery-region identity `shippingAreaId`.

## Existing repository behavior

- `apps/admin/src/components/admin/BranchForm.tsx`: manual, optional Shipment Area ID field.
- `apps/admin/src/lib/branches-service.ts`: nullable origin fields; only digit-format validation for area ID; omitted PUT fields preserve their stored values.
- `packages/db/src/schema/branches.ts`: local nullable shipping-origin complement, explicitly not overwritten by master sync.
- `apps/store/src/lib/shipment-regions.ts`: customer hierarchy lookup and canonical server-side validation of IDs and postcode.
- `apps/store/src/lib/shipment-inputs.ts`: area ID is currently optional for an otherwise valid origin.
- `docs/features/client-addresses.md`: pickup-only branches may remain unconfigured; customer address selection clears dependent regions and validates hierarchy server-side.

## Decisions still required

1. Is a verified shipping area mandatory for every branch mutation, or only for branches configured to support delivery? The existing pickup-only contract must not be changed implicitly.
2. Confirm whether implementation should include verified Omnichannel suggestions plus manual Shipment hierarchy selection, rather than automatic overwrites of local origin configuration.

No tests ran: only repository inspection, a read-only local query of branch location IDs, and authorized live API research were performed.
