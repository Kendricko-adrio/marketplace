export interface BranchShippingRegion {
  shippingProvinceId?: string | null; shippingCityId?: string | null; shippingDistrictId?: string | null;
  shippingAreaId?: string | null; shippingPostalCode?: string | null;
  shippingProvince?: string | null; shippingCity?: string | null; shippingDistrict?: string | null; shippingArea?: string | null;
}

/** Canonical stored configuration, never inferred from Omnichannel or free text. */
export function hasConfiguredBranchRegion(branch: BranchShippingRegion): boolean {
  return [branch.shippingProvinceId, branch.shippingCityId, branch.shippingDistrictId, branch.shippingAreaId]
    .every((id) => typeof id === "string" && /^\d{1,16}$/.test(id)) &&
    typeof branch.shippingPostalCode === "string" && /^\d{3,10}$/.test(branch.shippingPostalCode) &&
    [branch.shippingProvince, branch.shippingCity, branch.shippingDistrict, branch.shippingArea]
      .every((name) => typeof name === "string" && !!name.trim());
}
