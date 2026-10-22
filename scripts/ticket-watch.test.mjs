import { describe, expect, it } from "vitest";
import {
  emptyUsage,
  formatEntry,
  formatTotals,
  sumUsage,
  summarizeToolCall,
} from "./ticket-watch.mjs";

describe("summarizeToolCall", () => {
  it("memakai command bash, path file, dan query MCP", () => {
    expect(summarizeToolCall({ arguments: { command: "npm run verify:types:store" } })).toBe(
      "npm run verify:types:store"
    );
    expect(summarizeToolCall({ arguments: { path: "apps/store/src/lib/x.ts" } })).toBe(
      "apps/store/src/lib/x.ts"
    );
    expect(summarizeToolCall({ arguments: { query: "zlib inflate limit" } })).toBe(
      "zlib inflate limit"
    );
  });

  it("meringkas satu baris dan memotong input panjang", () => {
    const summary = summarizeToolCall({ arguments: { command: `echo a\n${"x".repeat(300)}` } });
    expect(summary).not.toContain("\n");
    expect(summary.length).toBeLessThanOrEqual(100);
  });

  it("jatuh ke string pertama untuk tool yang tidak dikenal", () => {
    expect(summarizeToolCall({ arguments: { note: "halo dunia" } })).toBe("halo dunia");
    expect(summarizeToolCall({})).toBe("");
  });
});

describe("sumUsage", () => {
  it("menjumlahkan input/output/token/cost dari beberapa pesan", () => {
    let usage = emptyUsage();
    usage = sumUsage(usage, {
      usage: {
        input: 100,
        output: 20,
        totalTokens: 120,
        cacheRead: 80,
        cost: { total: 0.5 },
      },
    });
    usage = sumUsage(usage, {
      usage: {
        input: 200,
        output: 30,
        totalTokens: 230,
        cacheRead: 300,
        cost: { total: 1.5 },
      },
    });
    expect(usage).toEqual({ input: 300, output: 50, total: 350, cacheRead: 300, cost: 2 });
    expect(formatTotals(usage)).toContain("tok=350");
    expect(formatTotals(usage)).toContain("$2.0000");
  });
});

describe("formatEntry", () => {
  const usage = { input: 10, output: 5, total: 15, cacheRead: 0, cost: 0 };

  it("menampilkan model, thinking, token, dan ringkasan tool call", () => {
    const text = formatEntry(
      {
        type: "message",
        timestamp: "2026-10-22T00:00:01.000Z",
        message: {
          role: "assistant",
          provider: "ollama",
          model: "deepseek-v4.1-flash:1017-cloud",
          thinkingLevel: "high",
          durationMs: 1200,
          stopReason: "toolUse",
          usage: { input: 10, output: 5, totalTokens: 15 },
          content: [
            { type: "thinking", thinking: "pertimbangan" },
            { type: "text", text: "saya cek dulu" },
            { type: "toolCall", name: "bash", arguments: { command: "ls apps" } },
          ],
        },
      },
      usage
    );
    expect(text).toContain("ollama/deepseek-v4.1-flash:1017-cloud");
    expect(text).toContain("think=high");
    expect(text).toContain("ctx=10 out=5");
    expect(text).toContain("Σ tok=15");
    expect(text).toContain("→ bash · ls apps");
    expect(text).toContain("stop=toolUse");
  });

  it("menandai tool result yang error dan memotong output", () => {
    const text = formatEntry(
      {
        type: "message",
        timestamp: "2026-10-22T00:00:02.000Z",
        message: {
          role: "toolResult",
          toolName: "bash",
          isError: true,
          durationMs: 45,
          content: [{ type: "text", text: "x".repeat(500) }],
        },
      },
      usage
    );
    expect(text).toContain("result bash");
    expect(text).toContain("ERROR");
    expect(text.length).toBeLessThan(200);
  });
});
