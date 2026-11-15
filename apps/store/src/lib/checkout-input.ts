export const MAX_CHECKOUT_BODY_BYTES = 256 * 1024;

export class CheckoutInputError extends Error {
  constructor(message: string, readonly status: 400 | 413 = 400) {
    super(message);
    this.name = "CheckoutInputError";
  }
}

/** Bounded streaming reader: Content-Length is advisory, never authority. */
export async function readCheckoutJson(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length && /^\d+$/.test(length) && BigInt(length) > BigInt(MAX_CHECKOUT_BODY_BYTES)) {
    throw new CheckoutInputError("Checkout body exceeds 256KiB", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new CheckoutInputError("Missing checkout body");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CHECKOUT_BODY_BYTES) {
        await reader.cancel();
        throw new CheckoutInputError("Checkout body exceeds 256KiB", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new CheckoutInputError("Invalid checkout JSON"); }
}
