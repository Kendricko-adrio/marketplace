import { buildShipmentParcel, type ShipmentParcelInput } from "./shipment-parcel";

export interface ShipmentOriginBranch {
  name: string; status: string;
  shippingPhone: string | null; shippingAddress: string | null;
  shippingPostalCode: string | null; shippingAreaId: string | null;
}

/** Does not infer origin from sync-managed branch address or Omnichannel IDs. */
export function buildShipmentInputs(input: ShipmentParcelInput & { branch: ShipmentOriginBranch }) {
  const branch = input.branch;
  const name = branch.name.trim();
  const phone = branch.shippingPhone?.trim() ?? "";
  const address = branch.shippingAddress?.trim() ?? "";
  const zipcode = branch.shippingPostalCode?.trim() ?? "";
  const area = branch.shippingAreaId?.trim();
  if (branch.status !== "aktif" || !name || !/^[0-9+()\s-]{5,25}$/.test(phone) || !/\d/.test(phone) || !address || address.length > 500 || !/^\d{3,10}$/.test(zipcode) || (area !== undefined && !/^\d{1,16}$/.test(area))) throw new Error("Shipment origin unavailable");
  return { origin: { name, phone, address, zipcode, ...(area ? { area_id: area } : {}) }, ...buildShipmentParcel(input) };
}
