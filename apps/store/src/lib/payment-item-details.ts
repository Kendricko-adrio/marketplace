export interface PaymentProductItem {
  id: string;
  name: string;
  price: string | number;
  quantity: number;
}

export interface PaymentItemDetail {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

export interface PaymentSnapshot {
  items: readonly PaymentProductItem[];
  discount: string | number;
  shippingCost: string | number;
  serviceFee: string | number;
  ppnRatePercent: string | number;
  ppnAmount: string | number;
  total: string | number;
}

function wholeRupiah(value: string | number, field: string): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) {
    throw new Error(`${field} must be a whole Rupiah amount`);
  }
  return amount;
}

export function buildPaymentItemDetails(snapshot: PaymentSnapshot): PaymentItemDetail[] {
  const details: PaymentItemDetail[] = snapshot.items.map((item) => ({
    id: item.id,
    name: item.name,
    price: wholeRupiah(item.price, "item price"),
    quantity: item.quantity,
  }));

  const adjustments: Array<[number, PaymentItemDetail]> = [
    [wholeRupiah(snapshot.discount, "discount"), { id: "DISCOUNT", name: "Discount", price: -wholeRupiah(snapshot.discount, "discount"), quantity: 1 }],
    [wholeRupiah(snapshot.ppnAmount, "PPN"), { id: "PPN", name: `PPN ${snapshot.ppnRatePercent}%`, price: wholeRupiah(snapshot.ppnAmount, "PPN"), quantity: 1 }],
    [wholeRupiah(snapshot.shippingCost, "shipping cost"), { id: "SHIPPING", name: "Shipping", price: wholeRupiah(snapshot.shippingCost, "shipping cost"), quantity: 1 }],
    [wholeRupiah(snapshot.serviceFee, "service fee"), { id: "SERVICE_FEE", name: "Service Fee", price: wholeRupiah(snapshot.serviceFee, "service fee"), quantity: 1 }],
  ];
  for (const [amount, detail] of adjustments) {
    if (amount !== 0) details.push(detail);
  }

  const lineTotal = details.reduce(
    (sum, detail) => sum + detail.price * detail.quantity,
    0
  );
  if (lineTotal !== wholeRupiah(snapshot.total, "total")) {
    throw new Error("Payment item details must equal order total");
  }
  return details;
}
