import { describe, expect, it } from "vitest";
import { createShipmentRegionGateway } from "./shipment-regions";

const chain = { recipientName: "Penerima", phone: "08123456789", fullAddress: "Jalan Uji 1", provinceId: "01", cityId: "0101", districtId: "010101", areaId: "01010101", postalCode: "01234", isDefault: false };
const bodies: Record<string, unknown> = {
  "/region/provinces": [{ province_id: "01", name: "Fixture Province" }],
  "/region/cities/01": [{ city_id: "0101", province_id: "01", name: "Fixture City" }],
  "/region/districts/0101": [{ district_id: "010101", city_id: "0101", name: "Fixture District" }],
  "/region/areas/010101": [{ area_id: "01010101", district_id: "010101", name: "Fixture Area", zipcode: "01234" }],
};
const gateway = () => createShipmentRegionGateway({ baseUrl: "http://127.0.0.1:3112", fetchImpl: async (url) => Response.json(bodies[new URL(String(url)).pathname]) });
describe("Shipment region hierarchy", () => {
  it("verifies the whole chain with string IDs and postal code including leading zeros", async () => {
    expect(await gateway().validateAddress(chain)).toEqual({ provinceId: "01", province: "Fixture Province", cityId: "0101", city: "Fixture City", districtId: "010101", district: "Fixture District", areaId: "01010101", area: "Fixture Area", postalCode: "01234" });
  });
  it("rejects postal mismatch and a city from another parent", async () => {
    await expect(gateway().validateAddress({ ...chain, postalCode: "99999" })).rejects.toThrow();
    const wrong = createShipmentRegionGateway({ baseUrl: "http://127.0.0.1:3112", fetchImpl: async (url) => Response.json(new URL(String(url)).pathname === "/region/cities/01" ? [{ city_id: "0101", province_id: "02", name: "Foreign" }] : bodies[new URL(String(url)).pathname]) });
    await expect(wrong.validateAddress(chain)).rejects.toThrow();
  });
});
