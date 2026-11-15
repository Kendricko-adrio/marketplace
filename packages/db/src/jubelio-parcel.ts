/** Canonical parcel unit: per-unit integer grams, dimensions in centimetres. */
export interface JubelioParcelDimensions { weight: number; length: number; width: number; height: number }

/** Master item detail, not catalog-group dimensions. Invalid block uses store fallback. */
export function normalizeJubelioMasterParcel(raw: unknown): JubelioParcelDimensions | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  function number(value: unknown): number {
    if (typeof value === "number") return value;
    if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim())) return Number(value.trim());
    return NaN;
  }
  const dimensions = { weight: number(row.package_weight), length: number(row.package_length), width: number(row.package_width), height: number(row.package_height) };
  return Number.isSafeInteger(dimensions.weight) && dimensions.weight > 0 && [dimensions.length, dimensions.width, dimensions.height].every((n) => Number.isFinite(n) && n > 0) ? dimensions : null;
}
