import { canonicalizePromoCode } from "./discount-code";

export type DiscountDraftBenefit =
  | { kind: "fixed_goods"; paramsVersion: 1; fixedAmount: string | null }
  | { kind: "percentage_goods"; paramsVersion: 1; rate: string | null; capAmount: string | null }
  | { kind: "shipping"; paramsVersion: 1; capAmount: string | null };

export interface DiscountDraftConfiguration {
  draftSchemaVersion: 1;
  name: string | null;
  currency: "IDR";
  minSubtotal: string | null;
  startAt: string | null;
  endAt: string | null;
  benefit: DiscountDraftBenefit | null;
  capacity: {
    quotaCount: number | null;
    budgetAmount: string | null;
    perClientLimit: number | null;
  };
  codeChanges: {
    proposedCodes: string[];
    states: { codeId: string; expectedCodeVersion: number; state: "active" | "inactive" | "archived" }[];
  };
}

export interface DiscountDraftIssue {
  path: string;
  message: string;
}

/**
 * Snapshot draft kosong untuk Offer yang baru dibuat: satu sumber kebenaran
 * draft sejak awal, tanpa mengarang nama/benefit/kuota. Semua field opsional
 * tetap null sampai editor menyimpannya.
 */
export function createEmptyDiscountDraftConfiguration(): DiscountDraftConfiguration {
  return {
    draftSchemaVersion: 1,
    name: null,
    currency: "IDR",
    minSubtotal: null,
    startAt: null,
    endAt: null,
    benefit: null,
    capacity: { quotaCount: null, budgetAmount: null, perClientLimit: null },
    codeChanges: { proposedCodes: [], states: [] },
  };
}

export type DraftParseResult =
  | { success: true; configuration: DiscountDraftConfiguration }
  | { success: false; issues: DiscountDraftIssue[] };

const MONEY_MAX = BigInt("9999999999999");
const COUNT_MAX = 2147483647;
const ROOT_FIELDS = ["draftSchemaVersion", "name", "currency", "minSubtotal", "startAt", "endAt", "benefit", "capacity", "codeChanges"];

/** Validator internal: setiap hasil dibangun ulang; input tidak dimutasi atau diteruskan sebagai JSON bebas. */
class DraftParser {
  readonly issues: DiscountDraftIssue[] = [];

  issue(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  object(input: unknown, path: string, fields: readonly string[]): Record<string, unknown> {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      this.issue(path, "Konfigurasi draft tidak valid");
      return {};
    }
    const record = input as Record<string, unknown>;
    for (const field of Object.keys(record)) {
      if (!fields.includes(field)) this.issue(path ? `${path}.${field}` : field, "Field tidak didukung");
    }
    for (const field of fields) {
      if (!Object.hasOwn(record, field) || record[field] === undefined) {
        this.issue(path ? `${path}.${field}` : field, "Field tidak tersedia dalam snapshot");
      }
    }
    return record;
  }

  money(input: unknown, path: string, positive = false): string | null {
    if (input === null || input === "") return null;
    if (typeof input !== "string" || !/^\d{1,32}$/.test(input)) {
      this.issue(path, "Masukkan nominal dalam Rupiah utuh");
      return null;
    }
    const value = BigInt(input);
    if (value > MONEY_MAX || (positive && value === BigInt(0))) {
      this.issue(path, positive ? "Nominal harus lebih dari 0 dan maksimal Rp 9.999.999.999.999,00" : "Nominal maksimal Rp 9.999.999.999.999,00");
      return null;
    }
    return value.toString();
  }

  count(input: unknown, path: string): number | null {
    if (input === null) return null;
    if (typeof input !== "number" || !Number.isInteger(input) || input < 1 || input > COUNT_MAX) {
      this.issue(path, "Masukkan bilangan bulat dari 1 hingga 2147483647");
      return null;
    }
    return input;
  }

  instant(input: unknown, path: string): string | null {
    if (input === null || input === "") return null;
    const match = typeof input === "string"
      ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(input)
      : null;
    if (!match) {
      this.issue(path, "Masukkan tanggal valid dengan zona waktu");
      return null;
    }
    const [, year, month, day, hour, minute, second = "0", , , , offsetHour = "0", offsetMinute = "0"] = match;
    const y = Number(year), m = Number(month), d = Number(day);
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const timestamp = Date.parse(input as string);
    if (m < 1 || m > 12 || d < 1 || d > days[m - 1] || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || Number(offsetHour) > 23 || Number(offsetMinute) > 59 || !Number.isFinite(timestamp)) {
      this.issue(path, "Masukkan tanggal yang valid");
      return null;
    }
    return new Date(timestamp).toISOString();
  }

  benefit(input: unknown): DiscountDraftBenefit | null {
    if (input === null) return null;
    const kind = typeof input === "object" && input !== null && "kind" in input ? input.kind : undefined;
    const fields = kind === "fixed_goods" ? ["kind", "paramsVersion", "fixedAmount"]
      : kind === "shipping" ? ["kind", "paramsVersion", "capAmount"]
        : ["kind", "paramsVersion", "rate", "capAmount"];
    const value = this.object(input, "benefit", fields);
    if (value.paramsVersion !== 1) this.issue("benefit.paramsVersion", "Versi potongan tidak didukung");
    if (kind === "fixed_goods") {
      return { kind, paramsVersion: 1, fixedAmount: this.money(value.fixedAmount, "benefit.fixedAmount", true) };
    }
    if (kind === "shipping") {
      return { kind, paramsVersion: 1, capAmount: this.money(value.capAmount, "benefit.capAmount", true) };
    }
    if (kind === "percentage_goods") {
      const rate = this.rate(value.rate);
      return { kind, paramsVersion: 1, rate, capAmount: this.money(value.capAmount, "benefit.capAmount", true) };
    }
    this.issue("benefit.kind", "Pilih jenis potongan yang didukung");
    return null;
  }

  rate(input: unknown): string | null {
    if (input === null || input === "") return null;
    if (typeof input !== "string" || !/^\d{1,32}(?:\.\d{1,6})?$/.test(input)) {
      this.issue("benefit.rate", typeof input === "string" && /^\d+\.\d{7,}$/.test(input) ? "Maksimal 6 angka desimal" : "Masukkan persentase lebih dari 0 hingga 100%");
      return null;
    }
    const [whole, fraction = ""] = input.split(".");
    const scaled = BigInt(whole) * BigInt(1000000) + BigInt(fraction.padEnd(6, "0"));
    if (scaled <= BigInt(0) || scaled > BigInt(100000000)) {
      this.issue("benefit.rate", "Masukkan persentase lebih dari 0 hingga 100%");
      return null;
    }
    const trimmed = fraction.replace(/0+$/, "");
    return BigInt(whole).toString() + (trimmed ? `.${trimmed}` : "");
  }

  codes(input: unknown): DiscountDraftConfiguration["codeChanges"] {
    const value = this.object(input, "codeChanges", ["proposedCodes", "states"]);
    const proposedCodes: string[] = [];
    const states: DiscountDraftConfiguration["codeChanges"]["states"] = [];
    if (!Array.isArray(value.proposedCodes) || value.proposedCodes.length > 50) {
      this.issue("codeChanges.proposedCodes", "Maksimal 50 kode baru per draft");
    } else {
      const seen = new Set<string>();
      value.proposedCodes.forEach((raw, index) => {
        const code = canonicalizePromoCode(raw);
        if (!code || seen.has(code)) this.issue(`codeChanges.proposedCodes.${index}`, "Kode tidak valid atau duplikat dalam draft");
        else { seen.add(code); proposedCodes.push(code); }
      });
    }
    if (!Array.isArray(value.states)) {
      this.issue("codeChanges.states", "Daftar perubahan kode tidak valid");
    } else {
      const seen = new Set<string>();
      value.states.forEach((raw, index) => {
        const path = `codeChanges.states.${index}`;
        const row = this.object(raw, path, ["codeId", "expectedCodeVersion", "state"]);
        if (typeof row.codeId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(row.codeId) || seen.has(row.codeId)) {
          this.issue(`${path}.codeId`, "Identitas kode tidak valid atau duplikat");
        } else {
          seen.add(row.codeId);
        }
        const version = this.count(row.expectedCodeVersion, `${path}.expectedCodeVersion`);
        if (version === null) this.issue(`${path}.expectedCodeVersion`, "Versi kode wajib diisi");
        if (row.state !== "active" && row.state !== "inactive" && row.state !== "archived") {
          this.issue(`${path}.state`, "Pilih status kode yang valid");
        } else if (typeof row.codeId === "string" && version !== null) {
          states.push({ codeId: row.codeId, expectedCodeVersion: version, state: row.state });
        }
      });
    }
    return { proposedCodes, states };
  }
}

/** Snapshot draft milik aplikasi, bukan payload pricing atau mutasi live. */
export function parseDiscountDraftConfiguration(input: unknown): DraftParseResult {
  const parser = new DraftParser();
  const value = parser.object(input, "", ROOT_FIELDS);
  if (value.draftSchemaVersion !== 1) parser.issue("draftSchemaVersion", "Versi draft tidak didukung");
  if (value.currency !== "IDR") parser.issue("currency", "Mata uang harus IDR");
  const name = typeof value.name === "string" ? value.name.trim() || null : null;
  if ((value.name !== null && typeof value.name !== "string") || (name !== null && name.length > 120)) {
    parser.issue("name", "Nama diskon maksimal 120 karakter");
  }
  const capacity = parser.object(value.capacity, "capacity", ["quotaCount", "budgetAmount", "perClientLimit"]);
  const configuration: DiscountDraftConfiguration = {
    draftSchemaVersion: 1, name, currency: "IDR",
    minSubtotal: parser.money(value.minSubtotal, "minSubtotal"),
    startAt: parser.instant(value.startAt, "startAt"),
    endAt: parser.instant(value.endAt, "endAt"),
    benefit: parser.benefit(value.benefit),
    capacity: {
      quotaCount: parser.count(capacity.quotaCount, "capacity.quotaCount"),
      budgetAmount: parser.money(capacity.budgetAmount, "capacity.budgetAmount"),
      perClientLimit: parser.count(capacity.perClientLimit, "capacity.perClientLimit"),
    },
    codeChanges: parser.codes(value.codeChanges),
  };
  if (configuration.startAt !== null && configuration.endAt !== null && Date.parse(configuration.startAt) >= Date.parse(configuration.endAt)) {
    parser.issue("endAt", "Tanggal berakhir harus setelah tanggal mulai");
  }
  return parser.issues.length ? { success: false, issues: parser.issues } : { success: true, configuration };
}

/** Kelengkapan publish terpisah dari validitas draft parsial. */
export function validateDiscountDraftForPublish(configuration: DiscountDraftConfiguration): DiscountDraftIssue[] {
  const issues: DiscountDraftIssue[] = [];
  if (!configuration.name) issues.push({ path: "name", message: "Isi nama diskon" });
  const benefit = configuration.benefit;
  if (!benefit) issues.push({ path: "benefit", message: "Pilih jenis potongan" });
  else if (benefit.kind === "fixed_goods" && benefit.fixedAmount === null) {
    issues.push({ path: "benefit.fixedAmount", message: "Isi nominal potongan" });
  } else if (benefit.kind === "percentage_goods" && benefit.rate === null) {
    issues.push({ path: "benefit.rate", message: "Isi persentase diskon" });
  } else if (benefit.kind === "shipping" && benefit.capAmount === null) {
    issues.push({ path: "benefit.capAmount", message: "Isi maksimum subsidi ongkir" });
  }
  if (configuration.minSubtotal === null) issues.push({ path: "minSubtotal", message: "Isi minimum belanja" });
  if (configuration.capacity.quotaCount === null && configuration.capacity.budgetAmount === null) {
    issues.push({ path: "capacity", message: "Isi kuota atau budget" });
  }
  if (configuration.capacity.perClientLimit === null) {
    issues.push({ path: "capacity.perClientLimit", message: "Isi batas pemakaian per customer" });
  }
  return issues;
}
