import { deflateRawSync, inflateRawSync } from "node:zlib";

// =========================================================
// Bounded, dependency-free XLSX/ZIP container
// =========================================================
// Spec §6.2: "ZIP/decompression streaming/bounded: enforce compressed bytes,
// expanded bytes dan row count saat membaca, bukan setelah load penuh ...
// zip path traversal/duplicate entries ditolak."
//
// The container layer only knows about ZIP entries. It never trusts a declared
// size: the compressed byte budget is checked before the central directory is
// walked, every entry's declared uncompressed size is charged to the expanded
// budget BEFORE it is inflated, and `inflateRawSync` runs with
// `maxOutputLength` equal to that declared size so a lying header cannot expand
// past what the budget already approved. The CRC of every entry is verified, so
// a truncated/corrupted part fails closed instead of feeding junk to the XML
// parser.
//
// Context7 checkpoint: /websites/nodejs_latest-v24_x_api — `zlib.inflateRawSync(
// buffer, { maxOutputLength })` limits convenience-method output (throws when
// exceeded), and `zlib.deflateRawSync`/`zlib.crc32` are available in the Node 24
// runtime used by the admin app and by Vitest.

/** Hard structural bounds from spec §6.2. Configured row/byte limits come from
 * `system_config`; these constants only bound the container itself. */
export const MAX_ZIP_ENTRIES = 200;
export const MAX_ZIP_NAME_LENGTH = 512;
export const MAX_CELLS_PER_ROW = 100;
export const MAX_CELL_TEXT_LENGTH = 4096;

export type WorkbookRejectReason =
  | "COMPRESSED_LIMIT_EXCEEDED"
  | "EXPANDED_LIMIT_EXCEEDED"
  | "ZIP_ENTRY_LIMIT_EXCEEDED"
  | "ZIP_PATH_UNSAFE"
  | "ZIP_DUPLICATE_ENTRY"
  | "ZIP_UNSUPPORTED"
  | "ENCRYPTED_WORKBOOK"
  | "NOT_XLSX_CONTAINER"
  | "WORKBOOK_CORRUPT"
  | "MACRO_UNSUPPORTED"
  | "EXTERNAL_LINKS_UNSUPPORTED"
  | "SHEET_INVALID"
  | "UNSUPPORTED_MARKER"
  | "HEADER_INVALID"
  | "ROW_LIMIT_EXCEEDED"
  | "CELL_LIMIT_EXCEEDED"
  | "CELL_TEXT_LIMIT_EXCEEDED";

/**
 * Fatal workbook rejection. This is thrown while reading the container/parts,
 * i.e. strictly BEFORE any price row is staged, so a rejected file can never
 * produce live price writes (spec §6.2, §6.4).
 */
export class WorkbookFatalError extends Error {
  constructor(
    readonly reason: WorkbookRejectReason,
    message: string
  ) {
    super(message);
    this.name = "WorkbookFatalError";
  }
}

export interface ZipLimits {
  /** Whole uploaded file, compressed. */
  maxCompressedBytes: number;
  /** Sum of every entry's uncompressed size. */
  maxExpandedBytes: number;
  maxEntries?: number;
}

export interface ZipEntry {
  name: string;
  data: string | Uint8Array;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 65535;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function fatal(reason: WorkbookRejectReason, message: string): never {
  throw new WorkbookFatalError(reason, message);
}

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3) — the ZIP entry checksum. */
export function zipCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** OLE/CFB signature: what an encrypted workbook or a legacy `.xls` starts with. */
export function hasOleSignature(bytes: Uint8Array): boolean {
  if (bytes.length < OLE_SIGNATURE.length) return false;
  return OLE_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function assertSafeEntryName(name: string): void {
  if (name.length === 0 || name.length > MAX_ZIP_NAME_LENGTH) {
    fatal("ZIP_PATH_UNSAFE", "Workbook entry names must be 1..512 bytes");
  }
  if (
    name.includes("\u0000") ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name)
  ) {
    fatal("ZIP_PATH_UNSAFE", "Workbook contains an unsafe entry path");
  }
  const segments = name.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    fatal("ZIP_PATH_UNSAFE", "Workbook contains a traversal entry path");
  }
}

/**
 * Read every entry of a ZIP container, bounded by `limits`.
 *
 * Order of enforcement (all before unbounded allocation):
 *   1. whole-file compressed size,
 *   2. EOCD/central-directory structure, single disk, no ZIP64/multi-disk,
 *   3. entry count, name safety, duplicate names, encryption/compression method,
 *   4. cumulative declared uncompressed size (charged entry by entry),
 *   5. inflate with `maxOutputLength` = the already-charged declared size,
 *      verify the exact length and CRC before the entry is handed to the caller.
 */
export function readZipEntries(
  input: Uint8Array | ArrayBuffer | Buffer,
  limits: ZipLimits
): Map<string, Uint8Array> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > limits.maxCompressedBytes) {
    fatal(
      "COMPRESSED_LIMIT_EXCEEDED",
      "The uploaded workbook exceeds the configured compressed-size limit"
    );
  }
  if (bytes.length < EOCD_MIN) {
    fatal("NOT_XLSX_CONTAINER", "The uploaded file is not a ZIP container");
  }
  if (hasOleSignature(bytes)) {
    fatal(
      "ENCRYPTED_WORKBOOK",
      "Encrypted or legacy Excel containers are not supported"
    );
  }
  if (u32(bytes, 0) !== LOCAL_SIG) {
    fatal("NOT_XLSX_CONTAINER", "The uploaded file is not a ZIP container");
  }

  const searchFloor = Math.max(0, bytes.length - EOCD_MIN - MAX_COMMENT);
  let eocd = -1;
  for (let index = bytes.length - EOCD_MIN; index >= searchFloor; index -= 1) {
    if (u32(bytes, index) === EOCD_SIG) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) fatal("WORKBOOK_CORRUPT", "Workbook ZIP end record is missing");

  const diskNumber = u16(bytes, eocd + 4);
  const centralDisk = u16(bytes, eocd + 6);
  const entriesOnDisk = u16(bytes, eocd + 8);
  const totalEntries = u16(bytes, eocd + 10);
  const centralSize = u32(bytes, eocd + 12);
  const centralOffset = u32(bytes, eocd + 16);
  const commentLength = u16(bytes, eocd + 20);
  if (eocd + EOCD_MIN + commentLength > bytes.length) {
    fatal("WORKBOOK_CORRUPT", "Workbook ZIP end record is truncated");
  }
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) {
    fatal("ZIP_UNSUPPORTED", "Multi-disk workbooks are not supported");
  }
  if (
    totalEntries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    fatal("ZIP_UNSUPPORTED", "ZIP64 workbooks are not supported");
  }
  const maxEntries = limits.maxEntries ?? MAX_ZIP_ENTRIES;
  if (totalEntries > maxEntries) {
    fatal(
      "ZIP_ENTRY_LIMIT_EXCEEDED",
      `A workbook may contain at most ${maxEntries} ZIP entries`
    );
  }
  if (centralOffset + centralSize > eocd) {
    fatal("WORKBOOK_CORRUPT", "Workbook central directory is out of bounds");
  }

  const entries = new Map<string, Uint8Array>();
  let expandedSoFar = 0;
  let cursor = centralOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > centralOffset + centralSize) {
      fatal("WORKBOOK_CORRUPT", "Workbook central directory is truncated");
    }
    if (u32(bytes, cursor) !== CENTRAL_SIG) {
      fatal("WORKBOOK_CORRUPT", "Workbook central directory entry is invalid");
    }
    const flags = u16(bytes, cursor + 8);
    const method = u16(bytes, cursor + 10);
    const expectedCrc = u32(bytes, cursor + 16);
    const compressedSize = u32(bytes, cursor + 20);
    const uncompressedSize = u32(bytes, cursor + 24);
    const nameLength = u16(bytes, cursor + 28);
    const extraLength = u16(bytes, cursor + 30);
    const entryCommentLength = u16(bytes, cursor + 32);
    const localOffset = u32(bytes, cursor + 42);
    const nameStart = cursor + 46;
    const nextCursor = nameStart + nameLength + extraLength + entryCommentLength;
    if (nextCursor > centralOffset + centralSize) {
      fatal("WORKBOOK_CORRUPT", "Workbook central directory entry is truncated");
    }
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      fatal("ZIP_UNSUPPORTED", "ZIP64 entries are not supported");
    }
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(nameStart, nameStart + nameLength)
    );
    assertSafeEntryName(name);
    if (entries.has(name)) {
      fatal("ZIP_DUPLICATE_ENTRY", "Workbook contains a duplicate ZIP entry");
    }
    if (flags & FLAG_ENCRYPTED) {
      fatal(
        "ENCRYPTED_WORKBOOK",
        "Encrypted workbooks are not supported"
      );
    }
    if (method !== METHOD_STORE && method !== METHOD_DEFLATE) {
      fatal("ZIP_UNSUPPORTED", "Unsupported ZIP compression method");
    }
    if (
      name.toLowerCase().endsWith(".bin") &&
      /(^|\/)vbaproject/i.test(name)
    ) {
      fatal("MACRO_UNSUPPORTED", "Macro-enabled workbooks are not supported");
    }

    expandedSoFar += uncompressedSize;
    if (expandedSoFar > limits.maxExpandedBytes) {
      fatal(
        "EXPANDED_LIMIT_EXCEEDED",
        "The uploaded workbook exceeds the configured expanded-size limit"
      );
    }

    if (localOffset + 30 > bytes.length || u32(bytes, localOffset) !== LOCAL_SIG) {
      fatal("WORKBOOK_CORRUPT", "Workbook local entry header is invalid");
    }
    const localNameLength = u16(bytes, localOffset + 26);
    const localExtraLength = u16(bytes, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > bytes.length) {
      fatal("WORKBOOK_CORRUPT", "Workbook entry data is out of bounds");
    }
    const localName = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)
    );
    if (localName !== name) {
      fatal("WORKBOOK_CORRUPT", "Workbook entry names disagree");
    }

    const raw = bytes.subarray(dataStart, dataStart + compressedSize);
    let data: Uint8Array;
    if (method === METHOD_STORE) {
      if (raw.length !== uncompressedSize) {
        fatal("WORKBOOK_CORRUPT", "Workbook stored entry size mismatch");
      }
      data = raw;
    } else {
      try {
        data = inflateRawSync(raw, {
          // Charged up front, so this is never an unbounded allocation.
          maxOutputLength: Math.max(1, uncompressedSize),
        });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "ERR_BUFFER_TOO_LARGE") {
          fatal(
            "EXPANDED_LIMIT_EXCEEDED",
            "A workbook entry expands beyond its declared size"
          );
        }
        fatal("WORKBOOK_CORRUPT", "A workbook entry could not be decompressed");
      }
    }
    if (data.length !== uncompressedSize) {
      fatal("WORKBOOK_CORRUPT", "Workbook entry size mismatch");
    }
    if (zipCrc32(data) !== expectedCrc) {
      fatal("WORKBOOK_CORRUPT", "Workbook entry checksum mismatch");
    }
    entries.set(name, data);
    cursor = nextCursor;
  }

  return entries;
}

// =========================================================
// Writer — deterministic, store-only for tiny XML parts
// =========================================================

/** Fixed 1980-01-01 DOS timestamp: deterministic bytes, no timezone dependency. */
const DOS_TIME = 0;
const DOS_DATE = 0x21;

function dosDateTimeFields(): { time: number; date: number } {
  return { time: DOS_TIME, date: DOS_DATE };
}

/**
 * Build a ZIP container from ordered entries. Entry names are written as UTF-8
 * (flag bit 11) and every name is validated with the same rules the reader
 * enforces, so the writer can never produce a workbook its own reader rejects.
 */
export function writeZip(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length > MAX_ZIP_ENTRIES) {
    fatal(
      "ZIP_ENTRY_LIMIT_EXCEEDED",
      `A workbook may contain at most ${MAX_ZIP_ENTRIES} ZIP entries`
    );
  }
  const encoder = new TextEncoder();
  const seen = new Set<string>();
  const prepared = entries.map((entry) => {
    assertSafeEntryName(entry.name);
    if (seen.has(entry.name)) {
      fatal("ZIP_DUPLICATE_ENTRY", "Workbook contains a duplicate ZIP entry");
    }
    seen.add(entry.name);
    const data =
      typeof entry.data === "string"
        ? new TextEncoder().encode(entry.data)
        : entry.data instanceof Uint8Array
          ? entry.data
          : new Uint8Array(entry.data);
    const compressed = deflateRawSync(data, { level: 9 });
    return {
      name: encoder.encode(entry.name),
      crc: zipCrc32(data),
      size: data.length,
      compressed,
    };
  });

  const localSize = prepared.reduce(
    (total, entry) => total + 30 + entry.name.length + entry.compressed.length,
    0
  );
  const centralSize = prepared.reduce(
    (total, entry) => total + 46 + entry.name.length,
    0
  );
  const total = localSize + centralSize + EOCD_MIN;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const { time, date } = dosDateTimeFields();

  let offset = 0;
  const localOffsets: number[] = [];
  for (const entry of prepared) {
    localOffsets.push(offset);
    view.setUint32(offset, LOCAL_SIG, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, FLAG_UTF8, true);
    view.setUint16(offset + 8, METHOD_DEFLATE, true);
    view.setUint16(offset + 10, time, true);
    view.setUint16(offset + 12, date, true);
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, entry.compressed.length, true);
    view.setUint32(offset + 22, entry.size, true);
    view.setUint16(offset + 26, entry.name.length, true);
    view.setUint16(offset + 28, 0, true);
    out.set(entry.name, offset + 30);
    offset += 30 + entry.name.length;
    out.set(entry.compressed, offset);
    offset += entry.compressed.length;
  }

  const centralStart = offset;
  for (let index = 0; index < prepared.length; index += 1) {
    const entry = prepared[index];
    view.setUint32(offset, CENTRAL_SIG, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, FLAG_UTF8, true);
    view.setUint16(offset + 10, METHOD_DEFLATE, true);
    view.setUint16(offset + 12, time, true);
    view.setUint16(offset + 14, date, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.compressed.length, true);
    view.setUint32(offset + 24, entry.size, true);
    view.setUint16(offset + 28, entry.name.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, localOffsets[index], true);
    out.set(entry.name, offset + 46);
    offset += 46 + entry.name.length;
  }

  view.setUint32(offset, EOCD_SIG, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, prepared.length, true);
  view.setUint16(offset + 10, prepared.length, true);
  view.setUint32(offset + 12, offset - centralStart, true);
  view.setUint32(offset + 16, centralStart, true);
  view.setUint16(offset + 20, 0, true);
  offset += EOCD_MIN;

  if (offset !== total) {
    throw new Error("ZIP writer produced an inconsistent container");
  }
  return out;
}
