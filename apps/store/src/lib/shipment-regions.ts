import type { ClientAddressInput, ClientRegionGateway } from "./client-addresses";

export type RegionLevel = "provinces" | "cities" | "districts" | "areas";
export interface ShipmentRegion { id: string; name: string; parentId?: string; postalCode?: string }
const keys = { provinces: "province_id", cities: "city_id", districts: "district_id", areas: "area_id" } as const;
const parents = { cities: "province_id", districts: "city_id", areas: "district_id" } as const;

/** Shipment GET hierarchy, never the Omnichannel region IDs. No browser credentials. */
export function createShipmentRegionGateway(options: { baseUrl?: string; fetchImpl?: typeof fetch } = {}) {
  const baseUrl = (options.baseUrl ?? process.env.JUBELIO_SHIPMENT_URL ?? "https://api-shipment.jubelio.com").replace(/\/$/, "");
  const read = options.fetchImpl ?? fetch;
  async function list(level: RegionLevel, parentId?: string): Promise<ShipmentRegion[]> {
    if (!(level in keys) || (level !== "provinces" && !/^\d{1,16}$/.test(parentId ?? ""))) throw new Error("REGION_INPUT_INVALID");
    const path = level === "provinces" ? "/region/provinces" : `/region/${level}/${encodeURIComponent(parentId!)}`;
    const response = await read(`${baseUrl}${path}`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("REGION_UNAVAILABLE");
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error("REGION_UNAVAILABLE");
    return body.map((raw: unknown) => {
      if (!raw || typeof raw !== "object") throw new Error("REGION_UNAVAILABLE");
      const row = raw as Record<string, unknown>;
      const id = row[keys[level]];
      const parent = level === "provinces" ? undefined : row[parents[level]];
      if (typeof id !== "string" || !/^\d{1,16}$/.test(id) || typeof row.name !== "string" || !row.name.trim() ||
          (level !== "provinces" && parent !== parentId) ||
          (level === "areas" && (typeof row.zipcode !== "string" || !/^\d{3,10}$/.test(row.zipcode)))) throw new Error("REGION_UNAVAILABLE");
      return { id, name: row.name, ...(typeof parent === "string" ? { parentId: parent } : {}), ...(level === "areas" ? { postalCode: row.zipcode as string } : {}) };
    });
  }
  const validateAddress: ClientRegionGateway["validateAddress"] = async (input: ClientAddressInput) => {
    const province = (await list("provinces")).find((r) => r.id === input.provinceId);
    const city = (await list("cities", input.provinceId)).find((r) => r.id === input.cityId);
    const district = (await list("districts", input.cityId)).find((r) => r.id === input.districtId);
    const area = (await list("areas", input.districtId)).find((r) => r.id === input.areaId);
    if (!province || !city || !district || !area || area.postalCode !== input.postalCode) throw new Error("REGION_INPUT_INVALID");
    return { provinceId: province.id, province: province.name, cityId: city.id, city: city.name, districtId: district.id, district: district.name, areaId: area.id, area: area.name, postalCode: area.postalCode! };
  };
  return { list, validateAddress };
}
