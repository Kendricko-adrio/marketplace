import { addressApi } from "@/lib/address-api";
import { withRequestContext } from "@/lib/logger";

type Params = { params: Promise<{ id: string }> };

/**
 * HTTP entry `/api/addresses/[id]`. Logging bisnis tetap milik boundary bersama
 * `addressApi` (module `client-addresses`); wrapper hanya membuka request scope
 * agar baris tersebut ber-`requestId` kanonik, plus satu baris completion dan
 * header `x-request-id`. Argumen (`request` + `context.params` promise)
 * diteruskan apa adanya, dan tidak ada log route tambahan sehingga
 * `createModuleLogger` tidak diperlukan di file ini.
 */
async function updateAddress(request: Request, { params }: Params): Promise<Response> {
  return addressApi("update", async (book, userId) =>
    book.update(userId, (await params).id, await request.json())
  );
}

async function removeAddress(_request: Request, { params }: Params): Promise<Response> {
  return addressApi("remove", async (book, userId) =>
    book.remove(userId, (await params).id)
  );
}

export const PATCH = withRequestContext(updateAddress, "store-address");
export const DELETE = withRequestContext(removeAddress, "store-address");
