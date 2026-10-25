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

async function createAddress(request: Request): Promise<Response> {
  return addressApi("create", async (book, userId) =>
    book.create(userId, await request.json())
  );
}

export const GET = withRequestContext(listAddresses, "store-addresses");
export const POST = withRequestContext(createAddress, "store-addresses");
