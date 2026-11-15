import { vi } from "vitest";

// Independent provider contract fixture; string IDs deliberately contain zeros.
export const branchRegion = {
  shippingProvinceId: "01", shippingCityId: "0102", shippingDistrictId: "010203",
  shippingAreaId: "0102030004", shippingPostalCode: "01234",
};
export function mockShipmentRegions() {
  const rows: Record<string, unknown> = {
    "/region/provinces": [{ province_id: "01", name: "Provinsi Fixture" }],
    "/region/cities/01": [{ city_id: "0102", province_id: "01", name: "Kota Fixture" }],
    "/region/districts/0102": [{ district_id: "010203", city_id: "0102", name: "Kecamatan Fixture" }],
    "/region/areas/010203": [{ area_id: "0102030004", district_id: "010203", name: "Kelurahan Fixture", zipcode: "01234" }],
  };
  const fetchMock = vi.fn(async (url: string | URL | Request) => Response.json(rows[new URL(String(url)).pathname] ?? []));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
