export type RegionLevel = "provinces" | "cities" | "districts" | "areas";
export interface ShipmentRegion { id: string; name: string; parentId?: string; postalCode?: string }
export interface ShipmentRegionInput {
  provinceId: string; cityId: string; districtId: string; areaId: string; postalCode: string;
}
const keys = { provinces: "province_id", cities: "city_id", districts: "district_id", areas: "area_id" } as const;
const parents = { cities: "province_id", districts: "city_id", areas: "district_id" } as const;

/** Credential-free Shipment GET hierarchy. Each app owns its runtime URL and adapter. */
export function createShipmentRegionGateway(options: { baseUrl: string; fetchImpl?: typeof fetch }) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  async function list(level: RegionLevel, parentId?: string): Promise<ShipmentRegion[]> {
    if (!Object.hasOwn(keys, level) || (level !== "provinces" && !/^\d{1,16}$/.test(parentId ?? ""))) throw new Error("REGION_INPUT_INVALID");
    const path = level === "provinces" ? "/region/provinces" : `/region/${level}/${encodeURIComponent(parentId!)}`;
    let body: unknown;
    try {
      // Node's RequestInit omits cache; Next's fetch still needs no-store.
      const requestOptions = { cache: "no-store" as const, signal: AbortSignal.timeout(10000) };
      const response = await (options.fetchImpl ?? fetch)(`${baseUrl}${path}`, requestOptions);
      if (!response.ok) throw new Error("REGION_UNAVAILABLE");
      body = await response.json();
    } catch { throw new Error("REGION_UNAVAILABLE"); }
    if (!Array.isArray(body)) throw new Error("REGION_UNAVAILABLE");
    const ids = new Set<string>();
    return body.map((raw: unknown) => {
      if (!raw || typeof raw !== "object") throw new Error("REGION_UNAVAILABLE");
      const row = raw as Record<string, unknown>;
      const id = row[keys[level]];
      const parent = level === "provinces" ? undefined : row[parents[level]];
      if (typeof id !== "string" || !/^\d{1,16}$/.test(id) || ids.has(id) || typeof row.name !== "string" || !row.name.trim() ||
          (level !== "provinces" && parent !== parentId) ||
          (level === "areas" && (typeof row.zipcode !== "string" || !/^\d{3,10}$/.test(row.zipcode)))) throw new Error("REGION_UNAVAILABLE");
      ids.add(id);
      return { id, name: row.name, ...(typeof parent === "string" ? { parentId: parent } : {}), ...(level === "areas" ? { postalCode: row.zipcode as string } : {}) };
    });
  }
  async function validateAddress(input: ShipmentRegionInput) {
    const province = (await list("provinces")).find((r) => r.id === input.provinceId);
    if (!province) throw new Error("REGION_INPUT_INVALID");
    const city = (await list("cities", province.id)).find((r) => r.id === input.cityId);
    if (!city) throw new Error("REGION_INPUT_INVALID");
    const district = (await list("districts", city.id)).find((r) => r.id === input.districtId);
    if (!district) throw new Error("REGION_INPUT_INVALID");
    const area = (await list("areas", district.id)).find((r) => r.id === input.areaId);
    if (!area || area.postalCode !== input.postalCode) throw new Error("REGION_INPUT_INVALID");
    return { provinceId: province.id, province: province.name, cityId: city.id, city: city.name, districtId: district.id, district: district.name, areaId: area.id, area: area.name, postalCode: area.postalCode! };
  }
  return { list, validateAddress };
}
