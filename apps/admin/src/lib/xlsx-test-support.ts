import { deflateRawSync, inflateRawSync } from "node:zlib";

// =========================================================
// TEST-ONLY workbook fixture builder/reader
// =========================================================
// Deliberately independent from `xlsx-container.ts`/`price-workbook.ts`: the
// fixtures used to prove the parser must not be produced by the code under test,
// otherwise a shared bug would make both sides agree. This file is only imported
// by `*.test.ts` specs and the Playwright mock spec; the admin app never imports
// it (so it cannot leak into a route bundle).
//
// It supports the adversarial shapes the production reader must reject:
// declared-size lies, CRC lies, duplicate names, traversal names, encrypted
// flags, unsupported compression methods, extra parts and macros.

export interface FixtureEntry {
  name: string;
  data: string | Uint8Array;
  /** 0 = store, 8 = deflate (default). */
  method?: number;
  /** General purpose flag bits (bit 0 = encrypted). */
  flags?: number;
  /** Declared uncompressed size override (default: real length). */
  declaredSize?: number;
  /** Declared compressed size override. */
  declaredCompressedSize?: number;
  crc?: number;
}

function crcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

const TABLE = crcTable();

function crcOf(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function asBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? new TextEncoder().encode(value) : value;
}

/**
 * Build a ZIP container from explicit entries. Duplicate names are allowed on
 * purpose so tests can prove the reader rejects them (`Map`-based writers would
 * hide that case).
 */
export function buildZipFixture(entries: readonly FixtureEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const prepared = entries.map((entry) => {
    const data = asBytes(entry.data);
    const method = entry.method ?? 8;
    const stored =
      method === 8
        ? new Uint8Array(deflateRawSync(data, { level: 6 }))
        : data;
    return {
      name: encoder.encode(entry.name),
      data,
      method,
      flags: entry.flags ?? 0x0800,
      stored,
      crc: entry.crc ?? crcOf(data),
      declaredSize: entry.declaredSize ?? data.length,
      declaredCompressedSize: entry.declaredCompressedSize ?? stored.length,
    };
  });

  const locals = prepared.reduce(
    (total, entry) => total + 30 + entry.name.length + entry.stored.length,
    0
  );
  const centrals = prepared.reduce(
    (total, entry) => total + 46 + entry.name.length,
    0
  );
  const out = new Uint8Array(locals + centrals + 22);
  const view = new DataView(out.buffer);
  let offset = 0;
  const localOffsets: number[] = [];

  for (const entry of prepared) {
    localOffsets.push(offset);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, entry.flags, true);
    view.setUint16(offset + 8, entry.method, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, 0x21, true);
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, entry.declaredCompressedSize, true);
    view.setUint32(offset + 22, entry.declaredSize, true);
    view.setUint16(offset + 26, entry.name.length, true);
    view.setUint16(offset + 28, 0, true);
    out.set(entry.name, offset + 30);
    offset += 30 + entry.name.length;
    out.set(entry.stored, offset);
    offset += entry.stored.length;
  }

  const centralStart = offset;
  prepared.forEach((entry, index) => {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, entry.flags, true);
    view.setUint16(offset + 10, entry.method, true);
    view.setUint16(offset + 12, 0, true);
    view.setUint16(offset + 14, 0x21, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.declaredCompressedSize, true);
    view.setUint32(offset + 24, entry.declaredSize, true);
    view.setUint16(offset + 28, entry.name.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, localOffsets[index], true);
    out.set(entry.name, offset + 46);
    offset += 46 + entry.name.length;
  });

  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 8, prepared.length, true);
  view.setUint16(offset + 10, prepared.length, true);
  view.setUint32(offset + 12, offset - centralStart, true);
  view.setUint32(offset + 16, centralStart, true);
  return out;
}

/** Minimal reader for containers produced by the app (valid CRCs, no ZIP64). */
export function readZipFixture(buffer: Uint8Array): Map<string, Uint8Array> {
  const bytes = buffer;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error("fixture reader: EOCD not found");
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const entries = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error("fixture reader: bad central entry");
    }
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(
      bytes.subarray(cursor + 46, cursor + 46 + nameLength)
    );
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: size });
    entries.set(name, data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function textOf(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

// =========================================================
// Minimal XLSX part set (independent of the production writer)
// =========================================================

export const FIXTURE_SHEET = "xl/worksheets/sheet1.xml";
export const FIXTURE_SHEET_PATH = "xl/worksheets/sheet1.xml";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type CellSpec =
  | { kind: "text"; value: string }
  | { kind: "shared"; index: number }
  | { kind: "number"; value: number | string }
  | { kind: "formula"; formula: string; cached?: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "empty" };

export interface SheetRow {
  /** 1-based row number. */
  row: number;
  /** Column letter → cell. */
  cells: Record<string, CellSpec>;
}

function cellXml(reference: string, cell: CellSpec): string {
  if (cell.kind === "empty") {
    return `<c r="${reference}"/>`;
  }
  if (cell.kind === "formula") {
    const cache = cell.cached === undefined ? "" : `<v>${escapeXml(cell.cached)}</v>`;
    return `<c r="${reference}"><f>${escapeXml(cell.formula)}</f>${cache}</c>`;
  }
  if (cell.kind === "shared") {
    return `<c r="${reference}" t="s"><v>${cell.index}</v></c>`;
  }
  if (cell.kind === "number") {
    return `<c r="${reference}"><v>${escapeXml(String(cell.value))}</v></c>`;
  }
  if (cell.kind === "boolean") {
    return `<c r="${reference}" t="b"><v>${cell.value ? 1 : 0}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(
    cell.value
  )}</t></is></c>`;
}

export function sheetXml(rows: readonly SheetRow[]): string {
  const body = rows
    .map(
      (row) =>
        `<row r="${row.row}">${Object.entries(row.cells)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([column, cell]) => cellXml(`${column}${row.row}`, cell))
          .join("")}</row>`
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/** Standard non-macro xlsx parts, with a caller-supplied worksheet XML. */
export function workbookParts(
  sheet: string,
  options: { sheetName?: string; extraParts?: FixtureEntry[] } = {}
): FixtureEntry[] {
  const sheetName = options.sheetName ?? "Harga";
  return [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(
        sheetName
      )}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    { name: FIXTURE_SHEET, data: sheet },
    ...(options.extraParts ?? []),
  ];
}

/** Convenience: a complete valid workbook fixture from rows. */
export function buildWorkbookFixture(
  rows: readonly SheetRow[],
  options: { sheetName?: string; extraParts?: FixtureEntry[] } = {}
): Uint8Array {
  return buildZipFixture(workbookParts(sheetXml(rows), options));
}

/** Shared-string part for Excel-authored workbooks (`t="s"` cells). */
export function sharedStringsPart(strings: readonly string[]): FixtureEntry {
  const items = strings
    .map((value) => `<si><t xml:space="preserve">${escapeXml(value)}</t></si>`)
    .join("");
  return {
    name: "xl/sharedStrings.xml",
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${items}</sst>`,
  };
}

export const HEADER_ROW: SheetRow = {
  row: 2,
  cells: {
    A: { kind: "text", value: "sku" },
    B: { kind: "text", value: "action" },
    C: { kind: "text", value: "new_price" },
  },
};

export const MARKER_ROW: SheetRow = {
  row: 1,
  cells: { A: { kind: "text", value: "OKCIR_MARKDOWN_V1" } },
};
