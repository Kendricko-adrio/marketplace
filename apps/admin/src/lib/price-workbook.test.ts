import { describe, expect, it } from "vitest";

import {
  WORKBOOK_REFERENCE_HEADERS,
  WORKBOOK_ROW_ERROR,
  WORKBOOK_TEMPLATE_VERSION,
  parsePriceWorkbook,
  writePriceTemplate,
  writePriceWorkbook,
} from "./price-workbook";
import { WorkbookFatalError } from "./xlsx-container";
import {
  HEADER_ROW,
  MARKER_ROW,
  buildWorkbookFixture,
  buildZipFixture,
  readZipFixture,
  sharedStringsPart,
  sheetXml,
  textOf,
  workbookParts,
  type FixtureEntry,
  type SheetRow,
} from "./xlsx-test-support";

// =========================================================
// Seam H — versioned price workbook contract (spec §6.2, acceptance X02/X06)
// =========================================================
// Expected values are independent literals: fixtures are built by the separate
// `xlsx-test-support.ts` writer, never by the production writer under test.

const LIMITS = {
  maxRows: 1000,
  maxFileBytes: 5 * 1024 * 1024,
  maxExpandedBytes: 25 * 1024 * 1024,
};

function workbook(rows: readonly SheetRow[], extraParts: FixtureEntry[] = []) {
  return buildWorkbookFixture([MARKER_ROW, HEADER_ROW, ...rows], { extraParts });
}

function dataRow(row: number, sku: string, action: string, price?: number | string): SheetRow {
  return {
    row,
    cells: {
      A: { kind: "text", value: sku },
      B: { kind: "text", value: action },
      ...(price === undefined
        ? {}
        : typeof price === "number"
          ? { C: { kind: "number", value: price } }
          : { C: { kind: "text", value: price } }),
    },
  };
}

function fatalReason(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof WorkbookFatalError) return error.reason;
    throw error;
  }
  throw new Error("expected a WorkbookFatalError");
}

describe("parsePriceWorkbook — accepted rows", () => {
  it("menerima marker markdown_v1 dan file lama dengan identitas internal batch tetap stabil", () => {
    for (const marker of ["markdown_v1", "OKCIR_MARKDOWN_V1"]) {
      const bytes = buildWorkbookFixture([
        { row: 1, cells: { A: { kind: "text", value: marker } } },
        HEADER_ROW,
        dataRow(3, "SKU-MARKER", "set_price", 150000),
      ]);
      const parsed = parsePriceWorkbook(bytes, LIMITS);
      expect(parsed.templateVersion).toBe("OKCIR_MARKDOWN_V1");
      expect(parsed.acceptedCount).toBe(1);
      expect(parsed.rows[0].targetUnitPrice).toBe("150000");
    }
  });
  it("reads a valid workbook with exact SKUs, integer set_price and empty restore", () => {
    const parsed = parsePriceWorkbook(
      workbook([
        dataRow(3, "SKU-EXACT-01", "set_price", 240000),
        dataRow(4, "  SKU Space  ", "set_price", 85001),
        dataRow(5, "SKU-RESTORE", "restore_base"),
      ]),
      LIMITS
    );
    expect(parsed.templateVersion).toBe("OKCIR_MARKDOWN_V1");
    expect(parsed.rows.map((row) => row.inputSku)).toEqual([
      "SKU-EXACT-01",
      "  SKU Space  ",
      "SKU-RESTORE",
    ]);
    expect(parsed.rows[0]).toMatchObject({
      rowNumber: 3,
      action: "set_price",
      targetUnitPrice: "240000",
      error: null,
    });
    expect(parsed.rows[1].targetUnitPrice).toBe("85001");
    expect(parsed.rows[2]).toMatchObject({
      action: "restore_base",
      targetUnitPrice: null,
      error: null,
    });
    expect(parsed.acceptedCount).toBe(3);
    expect(parsed.errorCount).toBe(0);
  });

  it("resolves shared-string cells (Excel-authored workbooks)", () => {
    const strings = [
      "markdown_v1",
      "sku",
      "action",
      "new_price",
      "SKU-SHARED",
      "set_price",
    ];
    const sheet = sheetXml([
      {
        row: 1,
        cells: { A: { kind: "shared", index: 0 } },
      },
      {
        row: 2,
        cells: {
          A: { kind: "shared", index: 1 },
          B: { kind: "shared", index: 2 },
          C: { kind: "shared", index: 3 },
        },
      },
      {
        row: 3,
        cells: {
          A: { kind: "shared", index: 4 },
          B: { kind: "shared", index: 5 },
          C: { kind: "number", value: 100000 },
        },
      },
    ]);
    const bytes = buildZipFixture([
      ...workbookParts(sheet),
      sharedStringsPart(strings),
    ]);
    const parsed = parsePriceWorkbook(bytes, LIMITS);
    expect(parsed.rows[0]).toMatchObject({
      inputSku: "SKU-SHARED",
      action: "set_price",
      targetUnitPrice: "100000",
      error: null,
    });
  });

  it("ignores fully blank rows and reference-only rows", () => {
    const referenceHeaders: SheetRow = {
      row: 2,
      cells: {
        A: { kind: "text", value: "sku" },
        B: { kind: "text", value: "action" },
        C: { kind: "text", value: "new_price" },
        D: { kind: "text", value: "product_name" },
      },
    };
    const parsed = parsePriceWorkbook(
      buildWorkbookFixture([
        MARKER_ROW,
        referenceHeaders,
        dataRow(3, "SKU-A", "set_price", 100000),
        { row: 4, cells: {} },
        { row: 5, cells: { A: { kind: "empty" }, B: { kind: "empty" } } },
        {
          row: 6,
          cells: { D: { kind: "text", value: "Reference only" } },
        },
      ]),
      LIMITS
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].inputSku).toBe("SKU-A");
  });
});

describe("parsePriceWorkbook — row errors (kept as data, valid rows survive)", () => {
  it("fails partially filled rows without SKU but keeps the valid row", () => {
    const parsed = parsePriceWorkbook(
      workbook([
        dataRow(3, "SKU-VALID", "set_price", 100000),
        {
          row: 4,
          cells: {
            B: { kind: "text", value: "set_price" },
            C: { kind: "number", value: 50000 },
          },
        },
      ]),
      LIMITS
    );
    expect(parsed.rows.map((row) => row.error)).toEqual([
      null,
      WORKBOOK_ROW_ERROR.skuRequired,
    ]);
    expect(parsed.acceptedCount).toBe(1);
    expect(parsed.errorCount).toBe(1);
  });

  it("rejects text/nominal/fraction/zero and unsafe prices as PRICE_INVALID", () => {
    const parsed = parsePriceWorkbook(
      workbook([
        dataRow(3, "SKU-TEXT", "set_price", "Rp150.000"),
        { row: 4, cells: { A: { kind: "text", value: "SKU-FRAC" }, B: { kind: "text", value: "set_price" }, C: { kind: "number", value: "150000.5" } } },
        dataRow(5, "SKU-ZERO", "set_price", 0),
        { row: 6, cells: { A: { kind: "text", value: "SKU-NEG" }, B: { kind: "text", value: "set_price" }, C: { kind: "number", value: "-150" } } },
        dataRow(7, "SKU-MISSING", "set_price"),
      ]),
      LIMITS
    );
    expect(parsed.rows.map((row) => row.error)).toEqual([
      WORKBOOK_ROW_ERROR.priceInvalid,
      WORKBOOK_ROW_ERROR.priceInvalid,
      WORKBOOK_ROW_ERROR.priceInvalid,
      WORKBOOK_ROW_ERROR.priceInvalid,
      // A blank price is not a restore.
      WORKBOOK_ROW_ERROR.priceRequired,
    ]);
  });

  it("rejects restore with a price and unknown actions", () => {
    const parsed = parsePriceWorkbook(
      workbook([
        dataRow(3, "SKU-RESTORE-PRICE", "restore_base", 100000),
        dataRow(4, "SKU-ACTION", "SET_PRICE", 100000),
        dataRow(5, "SKU-ACTION-EMPTY", ""),
      ]),
      LIMITS
    );
    expect(parsed.rows.map((row) => row.error)).toEqual([
      WORKBOOK_ROW_ERROR.priceNotAllowed,
      WORKBOOK_ROW_ERROR.actionInvalid,
      WORKBOOK_ROW_ERROR.actionInvalid,
    ]);
    expect(parsed.rows[1].actionRaw).toBe("SET_PRICE");
    expect(parsed.rows[1].action).toBe("invalid");
  });

  it("fails a numeric SKU cell (SKU must be exact text)", () => {
    const parsed = parsePriceWorkbook(
      workbook([
        {
          row: 3,
          cells: {
            A: { kind: "number", value: 12345 },
            B: { kind: "text", value: "set_price" },
            C: { kind: "number", value: 100000 },
          },
        },
      ]),
      LIMITS
    );
    expect(parsed.rows[0].error).toBe(WORKBOOK_ROW_ERROR.skuNotText);
  });

  it("fails every duplicate of a SKU, never last-row-wins", () => {
    const parsed = parsePriceWorkbook(
      workbook([
        dataRow(3, "SKU-DUP", "set_price", 100000),
        dataRow(4, "SKU-OTHER", "set_price", 120000),
        dataRow(5, "SKU-DUP", "restore_base"),
      ]),
      LIMITS
    );
    expect(parsed.rows.map((row) => row.error)).toEqual([
      WORKBOOK_ROW_ERROR.duplicateSku,
      null,
      WORKBOOK_ROW_ERROR.duplicateSku,
    ]);
    expect(parsed.rows[0].targetUnitPrice).toBeNull();
  });

  it("never evaluates formulas and never trusts a cached value", () => {
    const parsed = parsePriceWorkbook(
      workbook([
        {
          row: 3,
          cells: {
            A: { kind: "text", value: "SKU-FORMULA" },
            B: { kind: "text", value: "set_price" },
            C: { kind: "formula", formula: "1+1", cached: "999999" },
          },
        },
        {
          row: 4,
          cells: {
            A: { kind: "text", value: "SKU-REF-FORMULA" },
            B: { kind: "text", value: "set_price" },
            C: { kind: "number", value: 100000 },
            D: { kind: "formula", formula: "A1", cached: "x" },
          },
        },
      ]),
      LIMITS
    );
    expect(parsed.rows.map((row) => row.error)).toEqual([
      WORKBOOK_ROW_ERROR.formula,
      WORKBOOK_ROW_ERROR.formula,
    ]);
    expect(parsed.rows[0].targetUnitPrice).toBeNull();
  });

  it("validates the origin_row reference column", () => {
    const headersWithReferences: SheetRow = {
      row: 2,
      cells: {
        A: { kind: "text", value: "sku" },
        B: { kind: "text", value: "action" },
        C: { kind: "text", value: "new_price" },
        D: { kind: "text", value: "origin_row" },
      },
    };
    const parsed = parsePriceWorkbook(
      buildWorkbookFixture([
        MARKER_ROW,
        headersWithReferences,
        {
          row: 3,
          cells: {
            A: { kind: "text", value: "SKU-LINK-OK" },
            B: { kind: "text", value: "set_price" },
            C: { kind: "number", value: 90000 },
            D: { kind: "number", value: 7 },
          },
        },
        {
          row: 4,
          cells: {
            A: { kind: "text", value: "SKU-LINK-BAD" },
            B: { kind: "text", value: "set_price" },
            C: { kind: "number", value: 90000 },
            D: { kind: "text", value: "row-7" },
          },
        },
      ]),
      LIMITS
    );
    expect(parsed.rows[0]).toMatchObject({ originRow: 7, error: null });
    expect(parsed.rows[1].error).toBe(WORKBOOK_ROW_ERROR.originRowInvalid);
  });
});

describe("parsePriceWorkbook — fatal structural rejections", () => {
  it("rejects a missing/unsupported marker and extra row-1 content", () => {
    expect(
      fatalReason(() =>
        parsePriceWorkbook(
          buildWorkbookFixture([
            { row: 1, cells: { A: { kind: "text", value: "OKCIR_MARKDOWN_V2" } } },
            HEADER_ROW,
          ]),
          LIMITS
        )
      )
    ).toBe("UNSUPPORTED_MARKER");
    expect(
      fatalReason(() =>
        parsePriceWorkbook(
          buildWorkbookFixture([
            {
              row: 1,
              cells: {
                A: { kind: "text", value: WORKBOOK_TEMPLATE_VERSION },
                B: { kind: "text", value: "extra" },
              },
            },
            HEADER_ROW,
          ]),
          LIMITS
        )
      )
    ).toBe("HEADER_INVALID");
  });

  it("rejects missing, unknown, duplicate and reordered headers", () => {
    const cases: SheetRow[][] = [
      [
        {
          row: 2,
          cells: {
            A: { kind: "text", value: "sku" },
            B: { kind: "text", value: "action" },
          },
        },
      ],
      [
        {
          row: 2,
          cells: {
            A: { kind: "text", value: "sku" },
            B: { kind: "text", value: "action" },
            C: { kind: "text", value: "new_price" },
            D: { kind: "text", value: "harga_lain" },
          },
        },
      ],
      [
        {
          row: 2,
          cells: {
            A: { kind: "text", value: "sku" },
            B: { kind: "text", value: "sku" },
            C: { kind: "text", value: "new_price" },
          },
        },
      ],
      [
        {
          row: 2,
          cells: {
            A: { kind: "text", value: "action" },
            B: { kind: "text", value: "sku" },
            C: { kind: "text", value: "new_price" },
          },
        },
      ],
    ];
    for (const header of cases) {
      expect(
        fatalReason(() =>
          parsePriceWorkbook(
            buildWorkbookFixture([MARKER_ROW, ...header]),
            LIMITS
          )
        )
      ).toBe("HEADER_INVALID");
    }
  });

  it("rejects a wrong sheet name and additional worksheets", () => {
    expect(
      fatalReason(() =>
        parsePriceWorkbook(
          buildWorkbookFixture([MARKER_ROW, HEADER_ROW], { sheetName: "Sheet1" }),
          LIMITS
        )
      )
    ).toBe("SHEET_INVALID");

    expect(
      fatalReason(() =>
        parsePriceWorkbook(
          buildWorkbookFixture([MARKER_ROW, HEADER_ROW], {
            extraParts: [
              { name: "xl/worksheets/sheet2.xml", data: sheetXml([]) },
            ],
          }),
          LIMITS
        )
      )
    ).toBe("SHEET_INVALID");
  });

  it("rejects macros, external relationships and encrypted containers", () => {
    expect(
      fatalReason(() =>
        parsePriceWorkbook(
          buildWorkbookFixture([MARKER_ROW, HEADER_ROW], {
            extraParts: [{ name: "xl/vbaProject.bin", data: "macro" }],
          }),
          LIMITS
        )
      )
    ).toBe("MACRO_UNSUPPORTED");

    const externalParts = workbookParts(
      sheetXml([MARKER_ROW, HEADER_ROW])
    ).filter((part) => part.name !== "xl/_rels/workbook.xml.rels");
    externalParts.push({
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId9" Type="x" Target="https://evil.test/a" TargetMode="External"/></Relationships>`,
    });
    expect(
      fatalReason(() =>
        parsePriceWorkbook(buildZipFixture(externalParts), LIMITS)
      )
    ).toBe("EXTERNAL_LINKS_UNSUPPORTED");

    const encrypted = new Uint8Array(64);
    encrypted.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
    expect(fatalReason(() => parsePriceWorkbook(encrypted, LIMITS))).toBe(
      "ENCRYPTED_WORKBOOK"
    );
  });

  it("rejects ZIP path traversal and duplicate entries before parsing parts", () => {
    const traversal = buildZipFixture([
      ...workbookParts(sheetXml([MARKER_ROW, HEADER_ROW])),
      { name: "../escape.xml", data: "x" },
    ]);
    expect(fatalReason(() => parsePriceWorkbook(traversal, LIMITS))).toBe(
      "ZIP_PATH_UNSAFE"
    );
    const duplicate = buildZipFixture([
      ...workbookParts(sheetXml([MARKER_ROW, HEADER_ROW])),
      { name: "xl/workbook.xml", data: "duplicate" },
    ]);
    expect(fatalReason(() => parsePriceWorkbook(duplicate, LIMITS))).toBe(
      "ZIP_DUPLICATE_ENTRY"
    );
  });

  it("enforces configured row/file/expanded limits exactly at the boundary", () => {
    const row = (index: number): SheetRow =>
      dataRow(index + 3, `SKU-${index + 1}`, "set_price", 100000);
    const atLimit = parsePriceWorkbook(
      workbook([row(0), row(1)]),
      { ...LIMITS, maxRows: 2 }
    );
    expect(atLimit.acceptedCount).toBe(2);

    expect(
      fatalReason(() =>
        parsePriceWorkbook(workbook([row(0), row(1), row(2)]), {
          ...LIMITS,
          maxRows: 2,
        })
      )
    ).toBe("ROW_LIMIT_EXCEEDED");

    const bytes = workbook([row(0)]);
    expect(
      fatalReason(() =>
        parsePriceWorkbook(bytes, { ...LIMITS, maxFileBytes: bytes.length - 1 })
      )
    ).toBe("COMPRESSED_LIMIT_EXCEEDED");
    expect(
      fatalReason(() =>
        parsePriceWorkbook(bytes, { ...LIMITS, maxExpandedBytes: 32 })
      )
    ).toBe("EXPANDED_LIMIT_EXCEEDED");
  });

  it("enforces the per-row cell count and per-cell text length while reading", () => {
    const tooManyCells: Record<string, { kind: "text"; value: string }> = {
      A: { kind: "text", value: "SKU-MANY" },
      B: { kind: "text", value: "set_price" },
      C: { kind: "text", value: "100000" },
    };
    for (let index = 3; index <= 101; index += 1) {
      let name = "";
      let value = index;
      while (value > 0) {
        name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
        value = Math.floor((value - 1) / 26);
      }
      tooManyCells[name] = { kind: "text", value: "x" };
    }
    expect(
      fatalReason(() =>
        parsePriceWorkbook(
          buildWorkbookFixture([
            MARKER_ROW,
            HEADER_ROW,
            { row: 3, cells: tooManyCells },
          ]),
          LIMITS
        )
      )
    ).toBe("CELL_LIMIT_EXCEEDED");

    expect(
      fatalReason(() =>
        parsePriceWorkbook(
          workbook([
            {
              row: 3,
              cells: {
                A: { kind: "text", value: "x".repeat(4097) },
                B: { kind: "text", value: "set_price" },
                C: { kind: "number", value: 100000 },
              },
            },
          ]),
          LIMITS
        )
      )
    ).toBe("CELL_TEXT_LIMIT_EXCEEDED");
  });
});

describe("writePriceTemplate / writePriceWorkbook", () => {
  it("writes the versioned template with official headers and no data rows", () => {
    const parts = readZipFixture(writePriceTemplate());
    expect([...parts.keys()]).toContain("xl/worksheets/sheet1.xml");
    const sheet = textOf(parts.get("xl/worksheets/sheet1.xml")!);
    expect(sheet).toContain(">markdown_v1<");
    expect(sheet).not.toMatch(/okcir/i);
    expect(sheet).toContain(">sku<");
    expect(sheet).toContain(">action<");
    expect(sheet).toContain(">new_price<");
    expect(sheet).not.toContain("<f>");
    const parsed = parsePriceWorkbook(writePriceTemplate(), LIMITS);
    expect(parsed.rows).toEqual([]);
    expect(parsed.headers).toEqual(["sku", "action", "new_price"]);
  });

  it("keeps literal text out of formulas (no prefix mangling, no <f> element)", () => {
    const bytes = writePriceWorkbook(
      [
        {
          sku: "=SUM(A1)",
          action: "set_price",
          newPrice: 100000,
          errorReason: "+formula",
        },
      ],
      { withReferences: true }
    );
    const sheet = textOf(readZipFixture(bytes).get("xl/worksheets/sheet1.xml")!);
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain("=SUM(A1)");
    expect(sheet).toContain("+formula");
    const parsed = parsePriceWorkbook(bytes, LIMITS);
    expect(parsed.rows[0].inputSku).toBe("=SUM(A1)");
  });

  it("produces a re-uploadable export whose reference columns are not authority", () => {
    const bytes = writePriceWorkbook(
      [
        {
          sku: "SKU-EXPORT",
          action: "set_price",
          newPrice: 240000,
          productName: "Produk Uji",
          variantLabel: "Hitam / 42",
          sourcePrice: "300000",
          effectivePrice: "240000",
          originRow: 12,
          errorReason: "",
        },
      ],
      { withReferences: true }
    );
    const parsed = parsePriceWorkbook(bytes, LIMITS);
    expect(parsed.headers).toEqual([
      "sku",
      "action",
      "new_price",
      ...WORKBOOK_REFERENCE_HEADERS,
    ]);
    expect(parsed.rows[0]).toMatchObject({
      inputSku: "SKU-EXPORT",
      action: "set_price",
      targetUnitPrice: "240000",
      originRow: 12,
      error: null,
    });
  });
});
