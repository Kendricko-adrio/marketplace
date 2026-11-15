import { describe, expect, it } from "vitest";

import {
  MAX_ZIP_ENTRIES,
  WorkbookFatalError,
  readZipEntries,
  writeZip,
  zipCrc32,
} from "./xlsx-container";
import {
  buildZipFixture,
  readZipFixture,
  textOf,
  type FixtureEntry,
} from "./xlsx-test-support";

// =========================================================
// Seam H — bounded ZIP container (spec §6.2, acceptance X02/X06)
// =========================================================
// Fixtures are built by `xlsx-test-support.ts`, an INDEPENDENT minimal writer, so
// a shared bug cannot make the reader and its fixture agree. Declared sizes/CRCs
// can be lied about on purpose to prove the reader bounds before inflating.

const SAFE_LIMITS = {
  maxCompressedBytes: 5 * 1024 * 1024,
  maxExpandedBytes: 25 * 1024 * 1024,
};

function fatalReason(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof WorkbookFatalError) return error.reason;
    throw error;
  }
  throw new Error("expected a WorkbookFatalError");
}

describe("zipCrc32", () => {
  it("matches known CRC-32 values", () => {
    expect(zipCrc32(new TextEncoder().encode(""))).toBe(0);
    expect(zipCrc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("readZipEntries / writeZip", () => {
  it("round-trips entries through the app writer and the independent reader", () => {
    const bytes = writeZip([
      { name: "[Content_Types].xml", data: new TextEncoder().encode("<Types/>") },
      { name: "xl/worksheets/sheet1.xml", data: new TextEncoder().encode("<x/>") },
    ]);
    const entries = readZipEntries(bytes, SAFE_LIMITS);
    expect([...entries.keys()]).toEqual([
      "[Content_Types].xml",
      "xl/worksheets/sheet1.xml",
    ]);
    expect(textOf(entries.get("xl/worksheets/sheet1.xml")!)).toBe("<x/>");
    expect(textOf(readZipFixture(bytes).get("[Content_Types].xml")!)).toBe(
      "<Types/>"
    );
  });

  it("rejects a non-ZIP container and an OLE/encrypted container", () => {
    expect(
      fatalReason(() => readZipEntries(new Uint8Array(64), SAFE_LIMITS))
    ).toBe("NOT_XLSX_CONTAINER");
    const ole = new Uint8Array(64);
    ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
    expect(fatalReason(() => readZipEntries(ole, SAFE_LIMITS))).toBe(
      "ENCRYPTED_WORKBOOK"
    );
  });

  it("enforces the compressed-byte budget before walking the archive", () => {
    const bytes = buildZipFixture([{ name: "a", data: "hello" }]);
    expect(
      fatalReason(() =>
        readZipEntries(bytes, {
          maxCompressedBytes: bytes.length - 1,
          maxExpandedBytes: SAFE_LIMITS.maxExpandedBytes,
        })
      )
    ).toBe("COMPRESSED_LIMIT_EXCEEDED");
  });

  it("charges each declared expanded size to the budget before inflating", () => {
    const bytes = buildZipFixture([
      { name: "a", data: "hello", declaredSize: 1000 },
    ]);
    expect(
      fatalReason(() =>
        readZipEntries(bytes, {
          maxCompressedBytes: SAFE_LIMITS.maxCompressedBytes,
          maxExpandedBytes: 999,
        })
      )
    ).toBe("EXPANDED_LIMIT_EXCEEDED");
  });

  it("stops a lying header that would expand past the approved size", () => {
    // Declares 10 bytes but actually deflates 100 000: charging 10 is not enough,
    // so `inflateRawSync({ maxOutputLength })` must abort the stream.
    const bytes = buildZipFixture([
      { name: "bomb.xml", data: "a".repeat(100_000), declaredSize: 10 },
    ]);
    expect(
      fatalReason(() =>
        readZipEntries(bytes, {
          maxCompressedBytes: SAFE_LIMITS.maxCompressedBytes,
          maxExpandedBytes: SAFE_LIMITS.maxExpandedBytes,
        })
      )
    ).toBe("EXPANDED_LIMIT_EXCEEDED");
  });

  it("rejects traversal/absolute/duplicate names", () => {
    for (const name of ["../evil.xml", "/abs.xml", "xl/../evil.xml", "a\\b.xml"]) {
      const bytes = buildZipFixture([{ name, data: "x" }]);
      expect(
        fatalReason(() => readZipEntries(bytes, SAFE_LIMITS)),
        name
      ).toBe("ZIP_PATH_UNSAFE");
    }
    const duplicate = buildZipFixture([
      { name: "a.xml", data: "1" },
      { name: "a.xml", data: "2" },
    ]);
    expect(fatalReason(() => readZipEntries(duplicate, SAFE_LIMITS))).toBe(
      "ZIP_DUPLICATE_ENTRY"
    );
  });

  it("rejects encryption flags, unsupported methods and bad checksums", () => {
    const encrypted = buildZipFixture([
      { name: "a.xml", data: "x", flags: 0x0801 },
    ]);
    expect(fatalReason(() => readZipEntries(encrypted, SAFE_LIMITS))).toBe(
      "ENCRYPTED_WORKBOOK"
    );

    const unsupported = buildZipFixture([
      { name: "a.xml", data: "x", method: 12 },
    ]);
    expect(fatalReason(() => readZipEntries(unsupported, SAFE_LIMITS))).toBe(
      "ZIP_UNSUPPORTED"
    );

    const badCrc = buildZipFixture([
      { name: "a.xml", data: "x", crc: 0x12345678 },
    ]);
    expect(fatalReason(() => readZipEntries(badCrc, SAFE_LIMITS))).toBe(
      "WORKBOOK_CORRUPT"
    );
  });

  it("limits the number of ZIP entries", () => {
    const entries: FixtureEntry[] = Array.from(
      { length: MAX_ZIP_ENTRIES + 1 },
      (_, index) => ({ name: `part-${index}.xml`, data: "x" })
    );
    expect(
      fatalReason(() => readZipEntries(buildZipFixture(entries), SAFE_LIMITS))
    ).toBe("ZIP_ENTRY_LIMIT_EXCEEDED");
  });
});
