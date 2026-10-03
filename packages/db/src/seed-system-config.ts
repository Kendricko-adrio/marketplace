// Delivery seed defaults. These rows are inserted by seed.ts into system_config.
export const shipmentSystemConfigSeedRows = [
  {
    key: "shipment.parcelFallback",
    value: '{"weight":250,"length":30,"width":20,"height":10}',
    type: "json",
    description: "Default per-unit fallback parcel: 250 grams, 30 x 20 x 10 cm. Verify against actual SKU measurements before delivery activation.",
  },
  {
    key: "shipment.packagingWeightGrams",
    value: "15",
    type: "json",
    description: "Default packaging weight of 15 grams for seeded delivery quotes; verify against operational packaging before activation.",
  },
];
