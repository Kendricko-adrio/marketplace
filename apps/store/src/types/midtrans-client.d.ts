declare module "midtrans-client" {
  export interface SnapConfig {
    isProduction: boolean;
    serverKey: string;
    clientKey?: string;
  }

  export interface TransactionDetails {
    order_id: string;
    gross_amount: number;
  }

  export interface CustomerDetails {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
  }

  export interface ItemDetail {
    id: string;
    name: string;
    price: number;
    quantity: number;
    brand?: string;
    category?: string;
  }

  // Order expiry sent to Snap so Midtrans auto-expires the transaction and
  // fires an `expire` webhook (primary release path for stock reservations).
  // start_time anchors the countdown at place-order time — without it, async
  // methods (VA/GoPay) only start counting when the customer confirms a channel,
  // so Midtrans' clock would drift past the local reservation TTL.
  export interface ExpiryParameter {
    unit: "minute" | "hour" | "day";
    duration: number;
    start_time?: string;
  }

  export interface TransactionParameter {
    transaction_details: TransactionDetails;
    enabled_payments?: string[];
    customer_details?: CustomerDetails;
    item_details?: ItemDetail[];
    credit_card?: { secure?: boolean };
    expiry?: ExpiryParameter;
  }

  export interface CreateTransactionResult {
    token: string;
    redirect_url: string;
  }

  // Minimal shape of the Snap transaction helper used by the sweep cron.
  export interface SnapTransaction {
    expire(orderId: string): Promise<unknown>;
  }

  export class Snap {
    transaction: SnapTransaction;
    constructor(config: SnapConfig);
    createTransaction(
      parameter: TransactionParameter
    ): Promise<CreateTransactionResult>;
    createTransactionRedirectUrl(
      parameter: TransactionParameter
    ): Promise<string>;
    createTransactionToken(parameter: TransactionParameter): Promise<string>;
  }

  const _default: { Snap: typeof Snap };
  export default _default;
}