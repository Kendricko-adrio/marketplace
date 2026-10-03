/** Pure adapter for the item-level Shipment v1.8 parcel envelope (grams/cm). */
export interface ShipmentDimensions {
  weight: number;
  length: number;
  width: number;
  height: number;
}

export interface ShipmentParcelInput {
  items: readonly {
    itemName: string;
    quantity: number;
    value: number;
    dimensions: ShipmentDimensions | null;
  }[];
  fallback: ShipmentDimensions | null;
  packagingWeight: number;
}

function validDimensions(value: ShipmentDimensions | null): value is ShipmentDimensions {
  return value !== null && typeof value === "object" && Number.isSafeInteger(value.weight) && [value.weight, value.length, value.width, value.height]
    .every((part) => typeof part === "number" && Number.isFinite(part) && part > 0);
}

export function buildShipmentParcel(input: ShipmentParcelInput) {
  if (!input.items.length || !Number.isSafeInteger(input.packagingWeight) || input.packagingWeight < 0) {
    throw new Error("Shipment parcel needs items and a valid packaging weight");
  }
  const items = input.items.map((item) => {
    if (!item.itemName.trim() || !Number.isSafeInteger(item.quantity) || item.quantity <= 0 ||
      !Number.isSafeInteger(item.value) || item.value < 0) {
      throw new Error("Shipment item name, quantity or value invalid");
    }
    const dimensions = validDimensions(item.dimensions) ? item.dimensions : input.fallback;
    if (!validDimensions(dimensions)) throw new Error("Shipment dimensions unavailable");
    return {
      item_name: item.itemName,
      quantity: item.quantity,
      value: item.value,
      weight: dimensions.weight,
      length: dimensions.length,
      width: dimensions.width,
      height: dimensions.height,
    };
  });
  const weight = items.reduce((total, item) => total + item.weight * item.quantity, input.packagingWeight);
  if (!Number.isSafeInteger(weight) || weight <= 0) throw new Error("Shipment parcel weight invalid");
  return { weight, items };
}
