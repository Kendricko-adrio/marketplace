import { z } from "zod";
import { createShipmentRegionGateway } from "@marketplace/db/src/shipment-regions";

const id = z.string().regex(/^\d{1,16}$/);
export const branchRegionSchema = {
  shippingProvinceId: id, shippingCityId: id, shippingDistrictId: id, shippingAreaId: id,
  shippingPostalCode: z.string().regex(/^\d{3,10}$/),
};
export function shipmentRegions() {
  return createShipmentRegionGateway({ baseUrl: process.env.JUBELIO_SHIPMENT_URL ?? "https://api-shipment.jubelio.com" });
}
export async function verifyBranchRegion(input: {
  shippingProvinceId: string; shippingCityId: string; shippingDistrictId: string; shippingAreaId: string; shippingPostalCode: string;
}) {
  const region = await shipmentRegions().validateAddress({
    provinceId: input.shippingProvinceId, cityId: input.shippingCityId, districtId: input.shippingDistrictId,
    areaId: input.shippingAreaId, postalCode: input.shippingPostalCode,
  });
  return {
    shippingProvinceId: region.provinceId, shippingProvince: region.province,
    shippingCityId: region.cityId, shippingCity: region.city,
    shippingDistrictId: region.districtId, shippingDistrict: region.district,
    shippingAreaId: region.areaId, shippingArea: region.area, shippingPostalCode: region.postalCode,
  };
}
