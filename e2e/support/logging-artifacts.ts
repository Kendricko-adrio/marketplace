/**
 * Pembaca artifact log untuk spec korelasi logging pada server NYATA.
 *
 * Artifact yang dibaca adalah file stdout mentah proses app pada harness
 * (jalur `E2E_LOGGING_STORE_LOG` / `E2E_LOGGING_ADMIN_LOG` dari
 * `playwright.mock.config.ts`). Isinya baris JSON `@marketplace/logging`
 * tercampur output `next dev`, dan bisa berakhir dengan baris parsial karena
 * file sedang ditulis saat dibaca.
 *
 * Karena itu reader ini sengaja toleran: file yang belum ada, baris non-JSON,
 * dan baris parsial semuanya menjadi "belum teramati" (bukan kegagalan), supaya
 * pemanggil bisa memakai `expect.poll` sampai capture benar-benar muncul.
 *
 * Modul ini fixture test-only: tidak mengimpor logger app/core, tidak membuka
 * jaringan, dan tidak mengubah apa pun di luar pembacaan file.
 */
import { readFileSync } from "node:fs";

/** Satu baris log yang berhasil diparse, apa adanya (tanpa normalisasi). */
export type LogRecord = Record<string, unknown>;

/** Korelasi yang dipakai untuk memilih record milik satu request tertentu. */
export interface LogRecordSelector {
  readonly app: string;
  readonly module: string;
  readonly requestId: string;
}

/**
 * Baris JSON valid dari file artifact. `[]` bila file belum ada (capture belum
 * diimplementasikan / belum ditulis) atau belum bisa dibaca.
 */
export function readJsonLines(filePath: string): LogRecord[] {
  if (filePath.length === 0) {
    return [];
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    // Belum ada / belum bisa dibaca: belum teramati, bukan kegagalan.
    return [];
  }

  const records: LogRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Output `next dev` dan baris parsial bukan application log.
      continue;
    }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      records.push(parsed as LogRecord);
    }
  }
  return records;
}

/** Record milik satu app + module + requestId kanonik. */
export function selectRecords(
  records: readonly LogRecord[],
  selector: LogRecordSelector
): LogRecord[] {
  return records.filter(
    (record) =>
      record.app === selector.app &&
      record.module === selector.module &&
      record.requestId === selector.requestId
  );
}
