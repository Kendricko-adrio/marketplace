import { addressApi } from "@/lib/address-api";
import { withRequestContext } from "@/lib/logger";

/**
 * HTTP entry `/api/addresses`. Seluruh logging bisnis tetap milik boundary
 * bersama `addressApi` (module `client-addresses`); wrapper di bawah hanya
 * membuka request scope sehingga baris itu memakai `requestId` kanonik, plus
 * satu baris completion dan header `x-request-id`. Karena tidak ada log
 * tambahan di level route, file ini sengaja tidak membuat `createModuleLogger`
 * sendiri (menghindari logger yang tidak terpakai).
 */
async function listAddresses(): Promise<Response> {
  return addressApi("list", (book, userId) => book.list(userId));
}

/**
 * Create menerima header opsional `Idempotency-Key` (UUID) dari checkout. Header
 * diteruskan apa adanya ke boundary `addressApi`; normalisasi/validasi UUID dan
 * penolakan 400 tanpa mutation dimiliki seam persistence alamat. Consumer Buku
 * Alamat yang tidak mengirim header tetap kompatibel (create biasa).
 */
async function createAddress(request: Request): Promise<Response> {
  return addressApi(
    "create",
    async (book, userId, context) =>
      book.create(userId, await request.json(),
        context.requestKey === undefined ? {} : { requestKey: context.requestKey }),
    request
  );
}

export const GET = withRequestContext(listAddresses, "store-addresses");
export const POST = withRequestContext(createAddress, "store-addresses");
