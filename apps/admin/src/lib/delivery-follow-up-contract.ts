// Browser-safe action codes; never import a database service into client UI.
export const PACKING_FAILURE_REASONS = [
  "physical_stock_unavailable",
  "damaged_goods",
  "paid_service_limits_exceeded",
] as const;
