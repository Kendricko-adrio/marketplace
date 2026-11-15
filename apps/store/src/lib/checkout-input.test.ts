import { describe, expect, it } from "vitest";
import { readCheckoutJson } from "./checkout-input";

function streamed(chunks: string[]) {
  return new Request("http://localhost/checkout", {
    method: "POST", duplex: "half",
    body: new ReadableStream({ start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    } }),
  } as RequestInit);
}

describe("readCheckoutJson bounded public request reader", () => {
  it("accepts exactly 256KiB across chunks without Content-Length", async () => {
    const text = `{"value":"${"x".repeat(262132)}"}`;
    expect(new TextEncoder().encode(text).length).toBe(262144);
    await expect(readCheckoutJson(streamed([text.slice(0, 200), text.slice(200)]))).resolves.toEqual({ value: "x".repeat(262132) });
  });
  it("rejects bytes beyond the limit even without a declared length", async () => {
    await expect(readCheckoutJson(streamed(["{\"value\":\"", "x".repeat(262144), "\"}"]))).rejects.toMatchObject({ status: 413 });
  });
  it("counts UTF-8 bytes, not JavaScript characters", async () => {
    await expect(readCheckoutJson(streamed([`{"value":"${"é".repeat(140000)}"}`]))).rejects.toMatchObject({ status: 413 });
  });
  it("rejects invalid JSON", async () => {
    await expect(readCheckoutJson(streamed(["{"]))).rejects.toMatchObject({ status: 400 });
  });
});
