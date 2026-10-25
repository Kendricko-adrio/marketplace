import { MAX_MONEY_RUPIAH } from "@marketplace/db/src/versioned-pricing";

import {
  MAX_CELLS_PER_ROW,
  MAX_CELL_TEXT_LENGTH,
  MAX_ZIP_ENTRIES,
  WorkbookFatalError,
  hasOleSignature,
  readZipEntries,
  writeZip,
  type WorkbookRejectReason,
} from "./xlsx-container";

// =========================================================
// Price workbook contract (spec §6.2)
// =========================================================
// Template/export/report format:
//   sheet  : exactly one sheet named `Harga`
//   A1     : literal `markdown_v1`
//   row 2  : `sku`, `action`, `new_price` (this order), followed only by the
//            official NON-authoritative reference columns
//   row 3+ : data
//
// Rules enforced here, before any staging transaction exists:
//   - container/signature/part structure (no macro, no external relationship,
//     no encryption/legacy OLE, no extra sheet, no ZIP traversal/duplicate),
//   - marker + header (unknown/missing/duplicate header is fatal),
//   - configured row/byte bounds PLUS the structural entry/cell/text bounds,
//   - per-row validation: SKU exact text, action literal, integer Rupiah price,
//     formula cells fail the row (nothing is evaluated, no cached value is
//     trusted), blank rows ignored, partial rows without SKU fail the row, and
//     EVERY occurrence of a duplicated SKU fails.
//
// Row errors are returned as data (the file is still accepted so valid rows can
// be staged); only structural problems throw `WorkbookFatalError`. The caller
// records the row errors as `failed` rows and never applies them.

// Durable batch identity is unchanged so existing history, receipts, and the
// database CHECK remain compatible. This value is not the workbook label.
export const WORKBOOK_TEMPLATE_VERSION = "OKCIR_MARKDOWN_V1";
export const WORKBOOK_MARKER = "markdown_v1";
export const WORKBOOK_SHEET_NAME = "Harga";

export const WORKBOOK_INPUT_HEADERS = ["sku", "action", "new_price"] as const;
export const WORKBOOK_REFERENCE_HEADERS = [
  "row_number",
  "product_name",
  "variant",
  "source_price",
  "effective_price",
  "origin_row",
  "status",
  "error_reason",
] as const;

type InputHeader = (typeof WORKBOOK_INPUT_HEADERS)[number];
type ReferenceHeader = (typeof WORKBOOK_REFERENCE_HEADERS)[number];
export type WorkbookHeader = InputHeader | ReferenceHeader;

export interface WorkbookLimits {
  maxRows: number;
  maxFileBytes: number;
  maxExpandedBytes: number;
}

export const WORKBOOK_ROW_ERROR = {
  skuRequired: "SKU_REQUIRED",
  skuNotText: "SKU_NOT_TEXT",
  actionInvalid: "ACTION_INVALID",
  priceRequired: "PRICE_REQUIRED",
  priceInvalid: "PRICE_INVALID",
  priceNotAllowed: "PRICE_NOT_ALLOWED",
  formula: "FORMULA_NOT_SUPPORTED",
  duplicateSku: "DUPLICATE_SKU",
  originRowInvalid: "ORIGIN_ROW_INVALID",
  unexpectedColumn: "UNEXPECTED_COLUMN",
} as const;

export type WorkbookRowError =
  (typeof WORKBOOK_ROW_ERROR)[keyof typeof WORKBOOK_ROW_ERROR];

export type WorkbookAction = "set_price" | "restore_base" | "invalid";

export interface ParsedWorkbookRow {
  /** 1-based worksheet row number (row 3 is the first data row). */
  rowNumber: number;
  /** Raw SKU cell text; empty when the row has no SKU. */
  inputSku: string;
  /** Parsed action; `invalid` when the cell was not a known literal. */
  action: WorkbookAction;
  /** Raw action cell text (kept for the report). */
  actionRaw: string | null;
  /** Whole Rupiah target when the price cell was a positive integer. */
  targetUnitPrice: string | null;
  /** Raw price cell text (kept for the report/failed subset). */
  targetRaw: string | null;
  /** Official `origin_row` reference (validated server-side against a parent batch). */
  originRow: number | null;
  /** First row error, `null` when the row is accepted. */
  error: WorkbookRowError | null;
}

export interface ParsedPriceWorkbook {
  templateVersion: string;
  headers: WorkbookHeader[];
  rows: ParsedWorkbookRow[];
  acceptedCount: number;
  errorCount: number;
}

// =========================================================
// Minimal XML reader (pull tokenizer, bounded by the caller)
// =========================================================
// Only what a spreadsheet part needs: elements, attributes, text with the five
// XML entities plus numeric character references. Comments, CDATA and
// processing instructions are skipped. A malformed document is a fatal
// WORKBOOK_CORRUPT, never a partially parsed workbook.

type XmlToken =
  | { kind: "open" | "self"; name: string; attrs: Record<string, string> }
  | { kind: "close"; name: string }
  | { kind: "text"; text: string };

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g,
    (match, body: string) => {
      if (body === "amp") return "&";
      if (body === "lt") return "<";
      if (body === "gt") return ">";
      if (body === "quot") return '"';
      if (body === "apos") return "'";
      if (body.startsWith("#x") || body.startsWith("#X")) {
        return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
      }
      if (body.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
      }
      return match;
    }
  );
}

function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
}

class XmlReader {
  private index = 0;

  constructor(private readonly xml: string) {}

  next(): XmlToken | null {
    while (this.index < this.xml.length) {
      if (this.xml[this.index] !== "<") {
        const end = this.xml.indexOf("<", this.index);
        const text = this.xml.slice(
          this.index,
          end < 0 ? this.xml.length : end
        );
        this.index = end < 0 ? this.xml.length : end;
        return { kind: "text", text: decodeXmlEntities(text) };
      }
      if (this.xml.startsWith("<!--", this.index)) {
        const end = this.xml.indexOf("-->", this.index + 4);
        this.index = end < 0 ? this.xml.length : end + 3;
        continue;
      }
      if (this.xml.startsWith("<![CDATA[", this.index)) {
        const end = this.xml.indexOf("]]>", this.index + 9);
        const text = this.xml.slice(
          this.index + 9,
          end < 0 ? this.xml.length : end
        );
        this.index = end < 0 ? this.xml.length : end + 3;
        return { kind: "text", text };
      }
      if (this.xml.startsWith("<?", this.index)) {
        const end = this.xml.indexOf("?>", this.index + 2);
        this.index = end < 0 ? this.xml.length : end + 2;
        continue;
      }
      if (this.xml.startsWith("<!", this.index)) {
        const end = this.xml.indexOf(">", this.index + 2);
        this.index = end < 0 ? this.xml.length : end + 1;
        continue;
      }
      const end = this.findTagEnd();
      if (end < 0) {
        throw new WorkbookFatalError(
          "WORKBOOK_CORRUPT",
          "A workbook part ends inside a tag"
        );
      }
      const raw = this.xml.slice(this.index + 1, end).trim();
      this.index = end + 1;
      if (raw.startsWith("/")) {
        return { kind: "close", name: localName(raw.slice(1).trim()) };
      }
      const selfClosing = raw.endsWith("/");
      const content = selfClosing ? raw.slice(0, -1) : raw;
      const nameMatch = /^([^\s/>]+)/.exec(content);
      if (!nameMatch) {
        throw new WorkbookFatalError(
          "WORKBOOK_CORRUPT",
          "A workbook part contains an empty tag"
        );
      }
      const attrs: Record<string, string> = {};
      const attrPattern = /([^\s=]+)\s*=\s*"([^"]*)"/g;
      let match: RegExpExecArray | null;
      const rest = content.slice(nameMatch[0].length);
      while ((match = attrPattern.exec(rest)) !== null) {
        attrs[localName(match[1])] = decodeXmlEntities(match[2]);
      }
      return {
        kind: selfClosing ? "self" : "open",
        name: localName(nameMatch[0]),
        attrs,
      };
    }
    return null;
  }

  private findTagEnd(): number {
    let quote: string | null = null;
    for (let cursor = this.index + 1; cursor < this.xml.length; cursor += 1) {
      const char = this.xml[cursor];
      if (quote) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === ">") return cursor;
    }
    return -1;
  }
}

// =========================================================
// Part parsing
// =========================================================

interface RawCell {
  /** 0-based column index. */
  column: number;
  /** Cell type attribute (`s`, `inlineStr`, `str`, `n`, `b`, `e`, `d`). */
  type: string | null;
  formula: boolean;
  text: string;
}

interface RawRow {
  rowNumber: number;
  cells: Map<number, RawCell>;
}

function fatal(reason: WorkbookRejectReason, message: string): never {
  throw new WorkbookFatalError(reason, message);
}

function columnIndexFromReference(reference: string | undefined): number | null {
  if (!reference) return null;
  const match = /^([A-Za-z]{1,3})[0-9]+$/.exec(reference);
  if (!match) return null;
  let value = 0;
  for (const char of match[1].toUpperCase()) {
    value = value * 26 + (char.charCodeAt(0) - 64);
  }
  return value - 1;
}

function pushCellText(cell: RawCell, chunk: string): void {
  if (cell.text.length + chunk.length > MAX_CELL_TEXT_LENGTH) {
    fatal(
      "CELL_TEXT_LIMIT_EXCEEDED",
      `A workbook cell exceeds ${MAX_CELL_TEXT_LENGTH} characters`
    );
  }
  cell.text += chunk;
}

/** Parse one worksheet part into sparse rows, enforcing the structural cell
 * bounds while reading (never after a full DOM was built). */
function parseSheetRows(xml: string, maxRows: number): RawRow[] {
  const reader = new XmlReader(xml);
  const rows: RawRow[] = [];
  let row: RawRow | null = null;
  let rowNumber = 0;
  let cell: RawCell | null = null;
  let inValue = false;
  let inInline = false;
  let inText = false;
  let inPhonetic = false;
  let nextColumn = 0;
  let nonBlankRows = 0;

  const finishCell = () => {
    if (!cell) return;
    if (!row) fatal("WORKBOOK_CORRUPT", "A workbook cell is outside a row");
    if (cell.column >= MAX_CELLS_PER_ROW) {
      fatal(
        "CELL_LIMIT_EXCEEDED",
        `A workbook row may contain at most ${MAX_CELLS_PER_ROW} cells`
      );
    }
    row.cells.set(cell.column, cell);
    cell = null;
    inValue = false;
    inInline = false;
    inText = false;
    inPhonetic = false;
  };

  const finishRow = () => {
    finishCell();
    if (row) {
      const hasContent = [...row.cells.values()].some(
        (value) => value.formula || value.text.trim().length > 0
      );
      if (hasContent) {
        // The configured row limit counts DATA rows (row 3+); the marker and
        // header rows are structural, not import rows.
        if (row.rowNumber >= 3) {
          nonBlankRows += 1;
          if (nonBlankRows > maxRows) {
            fatal(
              "ROW_LIMIT_EXCEEDED",
              `A workbook may contain at most ${maxRows} non-blank data rows`
            );
          }
        }
        rows.push(row);
      }
    }
    row = null;
  };

  for (;;) {
    const token = reader.next();
    if (!token) break;
    if (token.kind === "text") {
      if (
        cell &&
        ((inValue && !inInline) || (inInline && inText && !inPhonetic))
      ) {
        pushCellText(cell, token.text);
      }
      continue;
    }
    if (token.kind === "open" || token.kind === "self") {
      switch (token.name) {
        case "row": {
          finishRow();
          const declared = Number.parseInt(token.attrs.r ?? "", 10);
          rowNumber =
            Number.isSafeInteger(declared) && declared > 0
              ? declared
              : rowNumber + 1;
          row = { rowNumber, cells: new Map() };
          nextColumn = 0;
          break;
        }
        case "c": {
          if (!row) break;
          finishCell();
          const reference = columnIndexFromReference(token.attrs.r);
          const column = reference ?? nextColumn;
          nextColumn = column + 1;
          cell = {
            column,
            type: token.attrs.t ?? null,
            formula: false,
            text: "",
          };
          if (token.kind === "self") finishCell();
          break;
        }
        case "f":
          if (cell) cell.formula = true;
          break;
        case "v":
          if (cell) inValue = true;
          break;
        case "is":
          if (cell) inInline = true;
          break;
        case "t":
          if (cell && inInline) inText = true;
          break;
        case "rPh":
          if (cell) inPhonetic = true;
          break;
        default:
          break;
      }
      continue;
    }
    switch (token.name) {
      case "v":
        inValue = false;
        break;
      case "t":
        inText = false;
        break;
      case "is":
        inInline = false;
        break;
      case "rPh":
        inPhonetic = false;
        break;
      case "c":
        finishCell();
        break;
      case "row":
        finishRow();
        break;
      default:
        break;
    }
  }
  finishRow();
  return rows;
}

function parseSharedStrings(entries: Map<string, Uint8Array>): string[] {
  const part = entries.get("xl/sharedStrings.xml");
  if (!part) return [];
  const reader = new XmlReader(new TextDecoder().decode(part));
  const strings: string[] = [];
  let current: string | null = null;
  let inText = false;
  for (;;) {
    const token = reader.next();
    if (!token) break;
    if (token.kind === "text") {
      if (current !== null && inText) {
        if (current.length + token.text.length > MAX_CELL_TEXT_LENGTH) {
          fatal(
            "CELL_TEXT_LIMIT_EXCEEDED",
            `A shared string exceeds ${MAX_CELL_TEXT_LENGTH} characters`
          );
        }
        current += token.text;
      }
      continue;
    }
    if (token.kind === "open" || token.kind === "self") {
      if (token.name === "si") current = "";
      else if (token.name === "t") inText = true;
      continue;
    }
    if (token.name === "t") inText = false;
    else if (token.name === "si") {
      if (current !== null) strings.push(current);
      current = null;
      inText = false;
    }
  }
  return strings;
}

interface WorkbookPartInfo {
  sheetName: string;
  sheetPath: string;
}

function parseWorkbookParts(
  entries: Map<string, Uint8Array>
): WorkbookPartInfo {
  if (!entries.has("[Content_Types].xml")) {
    fatal("NOT_XLSX_CONTAINER", "The workbook has no [Content_Types].xml part");
  }
  if (
    entries.has("xl/vbaProject.bin") ||
    entries.has("xl/vbaProjectSignature.bin")
  ) {
    fatal("MACRO_UNSUPPORTED", "Macro-enabled workbooks are not supported");
  }
  if (entries.has("EncryptedPackage") || entries.has("EncryptionInfo")) {
    fatal("ENCRYPTED_WORKBOOK", "Encrypted workbooks are not supported");
  }
  const contentTypes = new TextDecoder()
    .decode(entries.get("[Content_Types].xml")!)
    .toLowerCase();
  if (!contentTypes.includes("spreadsheetml.sheet.main+xml")) {
    fatal("NOT_XLSX_CONTAINER", "The container is not an .xlsx workbook");
  }
  if (contentTypes.includes("macroenabled")) {
    fatal("MACRO_UNSUPPORTED", "Macro-enabled workbooks are not supported");
  }

  for (const [name, data] of entries) {
    if (name.startsWith("xl/externalLinks/")) {
      fatal(
        "EXTERNAL_LINKS_UNSUPPORTED",
        "Workbooks with external links are not supported"
      );
    }
    if (name.endsWith(".rels")) {
      const text = new TextDecoder().decode(data);
      if (/TargetMode\s*=\s*"External"/i.test(text)) {
        fatal(
          "EXTERNAL_LINKS_UNSUPPORTED",
          "Workbooks with external relationships are not supported"
        );
      }
    }
    if (
      name.startsWith("xl/chartsheets/") ||
      name.startsWith("xl/dialogsheets/") ||
      name.startsWith("xl/macrosheets/") ||
      name.startsWith("xl/vbaProject")
    ) {
      fatal(
        "MACRO_UNSUPPORTED",
        "Only a plain .xlsx price workbook is supported"
      );
    }
  }

  const workbookPart = entries.get("xl/workbook.xml");
  if (!workbookPart) {
    fatal("NOT_XLSX_CONTAINER", "The workbook part is missing");
  }
  const sheets: Array<{ name: string; relId: string }> = [];
  {
    const reader = new XmlReader(new TextDecoder().decode(workbookPart));
    for (;;) {
      const token = reader.next();
      if (!token) break;
      if (token.kind === "open" || token.kind === "self") {
        if (token.name === "sheet") {
          sheets.push({
            name: token.attrs.name ?? "",
            relId: token.attrs.id ?? "",
          });
        }
      }
    }
  }
  if (sheets.length !== 1) {
    fatal("SHEET_INVALID", "The workbook must contain exactly one sheet");
  }
  if (sheets[0].name !== WORKBOOK_SHEET_NAME) {
    fatal(
      "SHEET_INVALID",
      `The single sheet must be named ${WORKBOOK_SHEET_NAME}`
    );
  }

  const relsPart = entries.get("xl/_rels/workbook.xml.rels");
  if (!relsPart) {
    fatal("NOT_XLSX_CONTAINER", "The workbook relationships part is missing");
  }
  let target: string | null = null;
  {
    const reader = new XmlReader(new TextDecoder().decode(relsPart));
    for (;;) {
      const token = reader.next();
      if (!token) break;
      if (token.kind === "open" || token.kind === "self") {
        if (
          token.name === "Relationship" &&
          token.attrs.Id === sheets[0].relId
        ) {
          target = token.attrs.Target ?? null;
        }
      }
    }
  }
  if (!target) {
    fatal("SHEET_INVALID", "The workbook sheet relationship is missing");
  }
  const resolved = target.startsWith("/")
    ? target.replace(/^\//, "")
    : `xl/${target.replace(/^xl\//, "")}`;
  if (
    resolved.includes("..") ||
    resolved.includes("\\") ||
    !resolved.startsWith("xl/worksheets/")
  ) {
    fatal("SHEET_INVALID", "The workbook sheet target is not a worksheet");
  }
  if (!entries.has(resolved)) {
    fatal("SHEET_INVALID", "The workbook sheet part is missing");
  }
  for (const name of entries.keys()) {
    if (
      name.startsWith("xl/worksheets/") &&
      name !== resolved &&
      name.endsWith(".xml")
    ) {
      fatal("SHEET_INVALID", "Additional worksheets are not supported");
    }
  }
  return { sheetName: sheets[0].name, sheetPath: resolved };
}

// =========================================================
// Header + row validation
// =========================================================

const ALL_HEADERS = new Set<string>([
  ...WORKBOOK_INPUT_HEADERS,
  ...WORKBOOK_REFERENCE_HEADERS,
]);

type CellKind = "empty" | "text" | "number" | "boolean" | "error" | "date";

function cellKind(cell: RawCell | undefined): CellKind {
  if (!cell) return "empty";
  if (cell.text.length === 0 && !cell.formula) return "empty";
  if (
    cell.type === "s" ||
    cell.type === "inlineStr" ||
    cell.type === "str"
  ) {
    return "text";
  }
  if (cell.type === "b") return "boolean";
  if (cell.type === "e") return "error";
  if (cell.type === "d") return "date";
  if (cell.type === null || cell.type === "n") return "number";
  return "error";
}

function cellText(cell: RawCell | undefined, shared: string[]): string {
  if (!cell) return "";
  if (cell.type === "s") {
    const index = Number.parseInt(cell.text, 10);
    if (!Number.isSafeInteger(index) || index < 0 || index >= shared.length) {
      fatal("WORKBOOK_CORRUPT", "A workbook shared-string index is invalid");
    }
    return shared[index];
  }
  return cell.text;
}

function parseHeaderRow(
  row: RawRow | undefined,
  shared: string[]
): WorkbookHeader[] {
  if (!row) fatal("HEADER_INVALID", "The header row is missing");
  const headers: WorkbookHeader[] = [];
  const seen = new Set<string>();
  let column = 0;
  for (;;) {
    const cell = row.cells.get(column);
    if (!cell || (cell.text.length === 0 && !cell.formula)) break;
    if (cell.formula || cellKind(cell) !== "text") {
      fatal("HEADER_INVALID", "Header cells must be plain text");
    }
    const text = cellText(cell, shared);
    if (!ALL_HEADERS.has(text)) {
      fatal("HEADER_INVALID", `Unknown header column "${text}"`);
    }
    if (seen.has(text)) {
      fatal("HEADER_INVALID", `Duplicate header column "${text}"`);
    }
    seen.add(text);
    headers.push(text as WorkbookHeader);
    column += 1;
  }
  if (headers.length < WORKBOOK_INPUT_HEADERS.length) {
    fatal("HEADER_INVALID", "The header row is missing required columns");
  }
  WORKBOOK_INPUT_HEADERS.forEach((header, index) => {
    if (headers[index] !== header) {
      fatal(
        "HEADER_INVALID",
        `The first three headers must be ${WORKBOOK_INPUT_HEADERS.join(", ")}`
      );
    }
  });
  for (let index = WORKBOOK_INPUT_HEADERS.length; index < headers.length; index += 1) {
    if (
      index > WORKBOOK_INPUT_HEADERS.length &&
      !WORKBOOK_REFERENCE_HEADERS.includes(headers[index - 1] as ReferenceHeader)
    ) {
      fatal("HEADER_INVALID", "Reference headers must stay contiguous");
    }
  }
  return headers;
}

/** `null` when the cell is not a plain non-negative integer Rupiah amount. */
function parseIntegerCell(
  cell: RawCell | undefined
): { value: number; raw: string } | null {
  if (!cell || cell.formula) return null;
  if (cellKind(cell) !== "number") return null;
  if (!/^\d+$/.test(cell.text)) return null;
  let amount: bigint;
  try {
    amount = BigInt(cell.text);
  } catch {
    return null;
  }
  if (amount < BigInt(1) || amount > MAX_MONEY_RUPIAH) return null;
  const value = Number(amount);
  if (!Number.isSafeInteger(value)) return null;
  return { value, raw: cell.text };
}

function classifyRows(
  rawRows: RawRow[],
  headers: WorkbookHeader[],
  shared: string[]
): ParsedWorkbookRow[] {
  const columnOf = (header: WorkbookHeader): number => headers.indexOf(header);
  const skuColumn = columnOf("sku");
  const actionColumn = columnOf("action");
  const priceColumn = columnOf("new_price");
  const originColumn = headers.includes("origin_row")
    ? columnOf("origin_row")
    : -1;

  const parsed: ParsedWorkbookRow[] = [];
  for (const raw of rawRows) {
    const cells = [...raw.cells.values()];
    if (
      !cells.some((cell) => cell.formula || cell.text.trim().length > 0)
    ) {
      continue;
    }

    const skuCell = raw.cells.get(skuColumn);
    const actionCell = raw.cells.get(actionColumn);
    const priceCell = raw.cells.get(priceColumn);
    const originCell = originColumn >= 0 ? raw.cells.get(originColumn) : undefined;

    const sku = cellText(skuCell, shared);
    const actionRaw = cellText(actionCell, shared);
    const targetRaw = cellText(priceCell, shared);
    const action: WorkbookAction =
      actionRaw === "set_price" || actionRaw === "restore_base"
        ? actionRaw
        : "invalid";

    let error: WorkbookRowError | null = null;
    let originRow: number | null = null;

    const hasFormula = cells.some((cell) => cell.formula);
    const unexpectedColumn = [...raw.cells.keys()].find(
      (column) => column >= headers.length
    );
    if (hasFormula) {
      error = WORKBOOK_ROW_ERROR.formula;
    } else if (unexpectedColumn !== undefined) {
      error = WORKBOOK_ROW_ERROR.unexpectedColumn;
    } else if (sku.length === 0) {
      if (actionRaw.length > 0 || targetRaw.length > 0) {
        error = WORKBOOK_ROW_ERROR.skuRequired;
      } else {
        // Only reference cells: nothing to import.
        continue;
      }
    } else if (cellKind(skuCell) !== "text") {
      error = WORKBOOK_ROW_ERROR.skuNotText;
    } else if (action === "invalid") {
      error = WORKBOOK_ROW_ERROR.actionInvalid;
    } else if (action === "set_price") {
      const numeric = parseIntegerCell(priceCell);
      if (targetRaw.length === 0) {
        // A blank price is NOT a restore.
        error = WORKBOOK_ROW_ERROR.priceRequired;
      } else if (numeric === null) {
        error = WORKBOOK_ROW_ERROR.priceInvalid;
      }
    } else if (targetRaw.length > 0) {
      error = WORKBOOK_ROW_ERROR.priceNotAllowed;
    }

    if (error === null && originColumn >= 0) {
      if (cellKind(originCell) !== "empty") {
        const numeric = parseIntegerCell(originCell);
        if (numeric === null) {
          error = WORKBOOK_ROW_ERROR.originRowInvalid;
        } else {
          originRow = numeric.value;
        }
      }
    }

    const numericPrice =
      error === null && action === "set_price"
        ? parseIntegerCell(priceCell)
        : null;

    parsed.push({
      rowNumber: raw.rowNumber,
      inputSku: sku,
      action,
      actionRaw: actionRaw.length > 0 ? actionRaw : null,
      targetUnitPrice: numericPrice ? String(numericPrice.value) : null,
      targetRaw: targetRaw.length > 0 ? targetRaw : null,
      originRow,
      error,
    });
  }

  // Every occurrence of a duplicated SKU fails — never last-row-wins.
  const counts = new Map<string, number>();
  for (const row of parsed) {
    if (row.inputSku.length > 0) {
      counts.set(row.inputSku, (counts.get(row.inputSku) ?? 0) + 1);
    }
  }
  for (const row of parsed) {
    if (row.inputSku.length > 0 && (counts.get(row.inputSku) ?? 0) > 1) {
      row.error = WORKBOOK_ROW_ERROR.duplicateSku;
      row.targetUnitPrice = null;
    }
  }

  return parsed;
}

// =========================================================
// Public parser
// =========================================================

/**
 * Parse and validate a price workbook. Throws `WorkbookFatalError` for every
 * structural problem (nothing is staged, so no price write can happen), and
 * returns per-row errors as data for a structurally valid container.
 */
export function parsePriceWorkbook(
  input: Uint8Array | ArrayBuffer | Buffer,
  limits: WorkbookLimits
): ParsedPriceWorkbook {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > limits.maxFileBytes) {
    fatal(
      "COMPRESSED_LIMIT_EXCEEDED",
      "The uploaded workbook exceeds the configured file-size limit"
    );
  }
  if (hasOleSignature(bytes)) {
    fatal(
      "ENCRYPTED_WORKBOOK",
      "Encrypted or legacy Excel containers are not supported"
    );
  }
  const entries = readZipEntries(bytes, {
    maxCompressedBytes: limits.maxFileBytes,
    maxExpandedBytes: limits.maxExpandedBytes,
    maxEntries: MAX_ZIP_ENTRIES,
  });
  const { sheetPath } = parseWorkbookParts(entries);
  const shared = parseSharedStrings(entries);
  const sheetXml = new TextDecoder().decode(entries.get(sheetPath)!);
  const rawRows = parseSheetRows(sheetXml, limits.maxRows);
  const byNumber = new Map(rawRows.map((row) => [row.rowNumber, row] as const));

  const marker = byNumber.get(1)?.cells.get(0);
  if (
    !marker ||
    cellKind(marker) !== "text" ||
    (cellText(marker, shared) !== WORKBOOK_MARKER &&
      cellText(marker, shared) !== WORKBOOK_TEMPLATE_VERSION)
  ) {
    fatal(
      "UNSUPPORTED_MARKER",
      `Cell A1 must be the literal ${WORKBOOK_MARKER}`
    );
  }
  const extraMarkerCells = [...byNumber.get(1)!.cells.entries()].some(
    ([column, cell]) => column > 0 && cell.text.length > 0
  );
  if (extraMarkerCells) {
    fatal("HEADER_INVALID", "Row 1 may only contain the version marker");
  }

  const headers = parseHeaderRow(byNumber.get(2), shared);
  const dataRows = [...byNumber.values()]
    .filter((row) => row.rowNumber >= 3)
    .sort((a, b) => a.rowNumber - b.rowNumber);
  const parsed = classifyRows(dataRows, headers, shared);

  return {
    templateVersion: WORKBOOK_TEMPLATE_VERSION,
    headers,
    rows: parsed,
    acceptedCount: parsed.filter((row) => row.error === null).length,
    errorCount: parsed.filter((row) => row.error !== null).length,
  };
}

// =========================================================
// Writer (template, export, report/failed subset)
// =========================================================

export interface PriceWorkbookRow {
  /** Batch row number (report); null/absent for export rows. */
  rowNumber?: number | null;
  /** Raw SKU / action / price text exactly as stored in the batch row. */
  sku: string;
  action: string;
  newPrice: string | number | null;
  productName?: string | null;
  variantLabel?: string | null;
  sourcePrice?: string | null;
  effectivePrice?: string | null;
  originRow?: number | null;
  /** Report-only durable row state: pending/applied/unchanged/failed. */
  status?: string | null;
  errorReason?: string | null;
}

export interface WritePriceWorkbookOptions {
  /** Include the official non-authoritative reference columns (export/report). */
  withReferences?: boolean;
}

function escapeXmlText(value: string): string {
  return value
    // XML 1.0 forbids most control characters; strip them instead of writing a
    // part no XML parser will accept.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function textCell(reference: string, value: string): string {
  const bounded =
    value.length > MAX_CELL_TEXT_LENGTH
      ? value.slice(0, MAX_CELL_TEXT_LENGTH)
      : value;
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(
    bounded
  )}</t></is></c>`;
}

function numberCell(reference: string, value: string): string {
  return `<c r="${reference}"><v>${escapeXmlText(value)}</v></c>`;
}

function columnName(index: number): string {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

/**
 * One typed spreadsheet cell. Text cells are ALWAYS written as `inlineStr`, so a
 * value starting with `=`, `+`, `-` or `@` stays a literal and is never an
 * executable formula.
 */
type WriteCell =
  | { kind: "text"; value: string }
  | { kind: "number"; value: string }
  | { kind: "empty" };

function buildWorkbookBytes(
  rows: readonly WriteCell[][],
  withReferences: boolean
): Uint8Array {
  const headers: WorkbookHeader[] = withReferences
    ? [...WORKBOOK_INPUT_HEADERS, ...WORKBOOK_REFERENCE_HEADERS]
    : [...WORKBOOK_INPUT_HEADERS];
  const sheetRows: string[] = [];
  const rowXml = (rowNumber: number, cells: string[]): string =>
    `<row r="${rowNumber}">${cells.join("")}</row>`;
  sheetRows.push(rowXml(1, [textCell("A1", WORKBOOK_MARKER)]));
  sheetRows.push(
    rowXml(
      2,
      headers.map((header, index) => textCell(`${columnName(index)}2`, header))
    )
  );
  rows.forEach((cells, index) => {
    const rowNumber = index + 3;
    sheetRows.push(
      rowXml(
        rowNumber,
        cells
          .map((cell, column) => {
            if (cell.kind === "empty") return "";
            const reference = `${columnName(column)}${rowNumber}`;
            return cell.kind === "number"
              ? numberCell(reference, cell.value)
              : textCell(reference, cell.value);
          })
          .filter((cell) => cell.length > 0)
      )
    );
  });

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows.join(
    ""
  )}</sheetData></worksheet>`;

  return writeZip([
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
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${WORKBOOK_SHEET_NAME}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: sheet,
    },
  ]);
}

const NUMERIC_REFERENCE = /^\d+$/;

/** Blank versioned template: marker in A1, official headers in row 2, no data. */
export function writePriceTemplate(): Uint8Array {
  return buildWorkbookBytes([], false);
}

/**
 * Workbook from durable row records. Text values are inline strings (literal,
 * never a formula); numeric columns stay numeric so the file is re-uploadable.
 */
export function writePriceWorkbook(
  rows: readonly PriceWorkbookRow[],
  options: WritePriceWorkbookOptions = {}
): Uint8Array {
  const withReferences = options.withReferences ?? false;
  const cells = rows.map((row): WriteCell[] => {
    const input: WriteCell[] = [
      { kind: "text", value: row.sku },
      { kind: "text", value: row.action },
      row.newPrice === null
        ? { kind: "empty" }
        : { kind: "number", value: String(row.newPrice) },
    ];
    if (!withReferences) return input;
    const reference = (
      value: string | null | undefined,
      numeric = false
    ): WriteCell => {
      if (value === null || value === undefined || value === "") {
        return { kind: "empty" };
      }
      return numeric && NUMERIC_REFERENCE.test(value)
        ? { kind: "number", value }
        : { kind: "text", value };
    };
    return [
      ...input,
      reference(
        row.rowNumber === null || row.rowNumber === undefined
          ? null
          : String(row.rowNumber),
        true
      ),
      reference(row.productName),
      reference(row.variantLabel),
      reference(row.sourcePrice, true),
      reference(row.effectivePrice, true),
      reference(
        row.originRow === null || row.originRow === undefined
          ? null
          : String(row.originRow),
        true
      ),
      reference(row.status),
      reference(row.errorReason),
    ];
  });
  return buildWorkbookBytes(cells, withReferences);
}
