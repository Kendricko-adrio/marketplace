import { addressApi } from "@/lib/address-api";
import { withRequestContext } from "@/lib/logger";

/**
 * HTTP entry `/api/addresses/[id]/default`. Logging bisnis tetap milik boundary
 * bersama `addressApi` (module `client-addresses`); wrapper hanya membuka request
 * scope agar baris tersebut ber-`requestId` kanonik, plus satu baris completion
 * dan header `x-request-id`. Tidak ada log route tambahan, jadi
 * `createModuleLogger` tidak dideklarasikan di file ini.
 */
async function setDefaultAddress(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  return addressApi("set-default", async (book, userId) =>
    book.setDefault(userId, (await params).id)
  );
}

export const POST = withRequestContext(setDefaultAddress, "store-address-default");
