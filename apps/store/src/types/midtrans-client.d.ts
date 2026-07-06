declare module "midtrans-client" {
  export interface SnapConfig {
    isProduction: boolean;
    serverKey: string;
    clientKey?: string;
  }

  export interface CoreApiConfig {
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

  export interface TransactionParameter {
    transaction_details: TransactionDetails;
    payment_methods?: string[];
    customer_details?: CustomerDetails;
    item_details?: ItemDetail[];
    credit_card?: { secure?: boolean };
  }

  export interface CreateTransactionResult {
    token: string;
    redirect_url: string;
  }

  export interface ChargeParameter {
    payment_type: string;
    transaction_details: TransactionDetails;
    customer_details?: CustomerDetails;
    item_details?: ItemDetail[];
  }

  export interface ChargeAction {
    name: string;
    method: string;
    url: string;
  }

  export interface ChargeResponse {
    status_code: string;
    status_message: string;
    transaction_id: string;
    order_id: string;
    merchant_id?: string;
    gross_amount?: string;
    currency?: string;
    payment_type: string;
    transaction_time?: string;
    transaction_status: string;
    fraud_status?: string;
    actions?: ChargeAction[];
    qr_string?: string;
    acquirer?: string;
  }

  export class Snap {
    constructor(config: SnapConfig);
    createTransaction(
      parameter: TransactionParameter
    ): Promise<CreateTransactionResult>;
    createTransactionRedirectUrl(
      parameter: TransactionParameter
    ): Promise<string>;
    createTransactionToken(parameter: TransactionParameter): Promise<string>;
  }

  export class CoreApi {
    constructor(config: CoreApiConfig);
    charge(parameter: ChargeParameter): Promise<ChargeResponse>;
    capture(parameter: Record<string, unknown>): Promise<Record<string, unknown>>;
    cardRegister(parameter: Record<string, unknown>): Promise<Record<string, unknown>>;
    cardToken(parameter: Record<string, unknown>): Promise<Record<string, unknown>>;
    cardPointInquiry(tokenId: string): Promise<Record<string, unknown>>;
  }

  const _default: { Snap: typeof Snap; CoreApi: typeof CoreApi };
  export default _default;
}