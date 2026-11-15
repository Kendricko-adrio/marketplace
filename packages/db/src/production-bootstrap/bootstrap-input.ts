// =========================================================
// Production bootstrap input policy (pure — no DB, no filesystem)
// =========================================================
// The manifest is the explicit, non-secret description of the production
// reference data a fresh database receives. Everything here is a decision:
// which values are required, which operational defaults apply, and which
// requests the CLI must refuse before it touches a database.
//
// There is deliberately no `--force`, no fallback tax rate, and no development
// `.env` loading: a wrong target or an incomplete manifest is refused.

export type BootstrapSubcommand = "preflight" | "seed" | "verify";
export type BootstrapPhase = "before-migrate" | "after-migrate";
export type SystemConfigType = "string" | "number" | "json";

export interface SystemConfigRow {
  key: string;
  value: string;
  type: SystemConfigType;
  description: string;
}

export interface ProductionBootstrapConfig {
  version: 1;
  expectedDatabase: string;
  systemConfig: readonly SystemConfigRow[];
}

export interface ProductionBootstrapInput {
  subcommand: BootstrapSubcommand;
  configPath: string;
  phase: BootstrapPhase | null;
  importReportPath: string | null;
}

export interface BootstrapEnvironment {
  APP_ENV?: string;
  NODE_ENV?: string;
  DATABASE_URL?: string;
  [key: string]: string | undefined;
}

export interface TargetIdentity {
  database: string;
  role: string;
  isSuperuser: boolean;
  canCreateInPublic: boolean;
}

/** Exit codes shared by every production bootstrap command (§5). */
export const BOOTSTRAP_EXIT = {
  ok: 0,
  refused: 2,
  failed: 3,
  incomplete: 4,
} as const;

/** `system_config` key that marks a completed first reference seed. */
export const REFERENCE_MARKER_KEY = "production.bootstrapReferenceVersion";
export const REFERENCE_MARKER_VERSION = 1;

const SUBCOMMANDS: readonly BootstrapSubcommand[] = [
  "preflight",
  "seed",
  "verify",
];
const PHASES: readonly BootstrapPhase[] = ["before-migrate", "after-migrate"];
const FLAGS = ["--config", "--phase", "--import-report"] as const;

const KNOWN_MANIFEST_KEYS = ["version", "expectedDatabase", "systemConfig"];
const KNOWN_SYSTEM_CONFIG_KEYS = [
  "reservationTtlMinutes",
  "taxPpnRatePercent",
  "discountsContractVersion",
  "jubelioSalesTaxId",
  "discountImport",
  "shipment",
];
const KNOWN_DISCOUNT_IMPORT_KEYS = [
  "maxRows",
  "maxFileBytes",
  "maxExpandedBytes",
];
const KNOWN_SHIPMENT_KEYS = ["parcelFallback", "packagingWeightGrams"];
const PARCEL_KEYS = ["weight", "length", "width", "height"] as const;

const DEFAULT_DISCOUNT_IMPORT = {
  maxRows: 1000,
  maxFileBytes: 5242880,
  maxExpandedBytes: 26214400,
} as const;

/** Keys whose existing value must be resolved explicitly, never overwritten. */
export const CONTRACT_CONFIG_KEYS = [
  "reservation.ttlMinutes",
  "tax.ppnRatePercent",
  "discounts.contractVersion",
] as const;

const SECRET_KEY_PATTERN =
  /pass(word)?|secret|token|credential|api[_-]?key|private[_-]?key|dsn|database[_-]?url|connection[_-]?string/i;

export type ProductionBootstrapErrorCode =
  | "INVALID_ARGUMENT"
  | "INVALID_MANIFEST"
  | "UNKNOWN_MANIFEST_KEY"
  | "SECRET_IN_MANIFEST"
  | "MISSING_REQUIRED_CONFIG"
  | "INVALID_CONFIG_VALUE"
  | "PRODUCTION_ENV_REQUIRED"
  | "PRODUCTION_TARGET_MISMATCH"
  | "TARGET_PRIVILEGE_MISMATCH"
  | "MISSING_PROVIDER_CREDENTIALS";

export class ProductionBootstrapInputError extends Error {
  readonly code: ProductionBootstrapErrorCode;

  constructor(code: ProductionBootstrapErrorCode, message: string) {
    super(message);
    this.name = "ProductionBootstrapInputError";
    this.code = code;
  }
}

function refuse(code: ProductionBootstrapErrorCode, message: string): never {
  throw new ProductionBootstrapInputError(code, message);
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    refuse("INVALID_MANIFEST", `${what} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function assertKnownKeys(
  record: Record<string, unknown>,
  known: readonly string[],
  what: string
): void {
  for (const key of Object.keys(record)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      refuse(
        "SECRET_IN_MANIFEST",
        `${what} must not carry secrets; found "${key}"`
      );
    }
    if (!known.includes(key)) {
      refuse("UNKNOWN_MANIFEST_KEY", `unknown ${what} key "${key}"`);
    }
  }
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    refuse("INVALID_CONFIG_VALUE", `${field} must be a finite number`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, field: string): number {
  const parsed = requireNumber(value, field);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    refuse("INVALID_CONFIG_VALUE", `${field} must be a positive integer`);
  }
  return parsed;
}

function requireRow(
  systemConfig: Record<string, unknown>,
  key: string
): unknown {
  if (!(key in systemConfig) || systemConfig[key] === undefined) {
    refuse(
      "MISSING_REQUIRED_CONFIG",
      `systemConfig.${key} is required for a production bootstrap`
    );
  }
  return systemConfig[key];
}

function buildSystemConfigRows(
  systemConfig: Record<string, unknown>
): SystemConfigRow[] {
  const rows: SystemConfigRow[] = [];

  const ttl = requirePositiveInteger(
    requireRow(systemConfig, "reservationTtlMinutes"),
    "systemConfig.reservationTtlMinutes"
  );
  if (ttl > 1440) {
    refuse(
      "INVALID_CONFIG_VALUE",
      "systemConfig.reservationTtlMinutes must stay within the checkout TTL contract (<= 1440)"
    );
  }
  rows.push({
    key: "reservation.ttlMinutes",
    value: String(ttl),
    type: "number",
    description:
      "Menit TTL reservasi stok saat customer menunggu pembayaran. Kontrak checkout existing.",
  });

  const taxRate = requireNumber(
    requireRow(systemConfig, "taxPpnRatePercent"),
    "systemConfig.taxPpnRatePercent"
  );
  if (taxRate <= 0 || taxRate > 100) {
    refuse(
      "INVALID_CONFIG_VALUE",
      "systemConfig.taxPpnRatePercent must be greater than 0 and at most 100"
    );
  }
  rows.push({
    key: "tax.ppnRatePercent",
    value: String(taxRate),
    type: "number",
    description:
      "Persentase PPN customer dari kebijakan pajak bisnis. Wajib eksplisit; tidak ada fallback production.",
  });

  if (systemConfig.jubelioSalesTaxId !== undefined) {
    const taxId = requireNumber(
      systemConfig.jubelioSalesTaxId,
      "systemConfig.jubelioSalesTaxId"
    );
    if (!Number.isInteger(taxId) || taxId === 0) {
      refuse(
        "INVALID_CONFIG_VALUE",
        "systemConfig.jubelioSalesTaxId must be a non-zero integer Jubelio tax master id"
      );
    }
    rows.push({
      key: "jubelio.salesTaxId",
      value: String(taxId),
      type: "number",
      description:
        "Tax master Jubelio untuk PPN barang. Wajib diverifikasi terhadap GET /taxes/ tenant sebelum checkout aktif.",
    });
  }

  const contractVersion = requireNumber(
    requireRow(systemConfig, "discountsContractVersion"),
    "systemConfig.discountsContractVersion"
  );
  if (contractVersion !== 0 && contractVersion !== 1) {
    refuse(
      "INVALID_CONFIG_VALUE",
      "systemConfig.discountsContractVersion must be 0 or 1"
    );
  }
  rows.push({
    key: "discounts.contractVersion",
    value: String(contractVersion),
    type: "number",
    description:
      "Kontrak domain diskon yang dipilih operator. Nilai 0 bukan kesiapan checkout kontrak terkini.",
  });

  const discountImport =
    systemConfig.discountImport === undefined
      ? {}
      : asRecord(systemConfig.discountImport, "systemConfig.discountImport");
  assertKnownKeys(
    discountImport,
    KNOWN_DISCOUNT_IMPORT_KEYS,
    "systemConfig.discountImport"
  );
  const maxRows =
    discountImport.maxRows === undefined
      ? DEFAULT_DISCOUNT_IMPORT.maxRows
      : requirePositiveInteger(
          discountImport.maxRows,
          "systemConfig.discountImport.maxRows"
        );
  const maxFileBytes =
    discountImport.maxFileBytes === undefined
      ? DEFAULT_DISCOUNT_IMPORT.maxFileBytes
      : requirePositiveInteger(
          discountImport.maxFileBytes,
          "systemConfig.discountImport.maxFileBytes"
        );
  const maxExpandedBytes =
    discountImport.maxExpandedBytes === undefined
      ? DEFAULT_DISCOUNT_IMPORT.maxExpandedBytes
      : requirePositiveInteger(
          discountImport.maxExpandedBytes,
          "systemConfig.discountImport.maxExpandedBytes"
        );
  if (maxExpandedBytes < maxFileBytes) {
    refuse(
      "INVALID_CONFIG_VALUE",
      "systemConfig.discountImport.maxExpandedBytes must not be smaller than maxFileBytes"
    );
  }
  rows.push(
    {
      key: "discount.import.maxRows",
      value: String(maxRows),
      type: "number",
      description:
        "Batas baris import/bulk harga Markdown per batch. Dibaca ulang setiap request.",
    },
    {
      key: "discount.import.maxFileBytes",
      value: String(maxFileBytes),
      type: "number",
      description:
        "Batas ukuran file workbook harga (byte terkompresi). Nilai invalid menolak operasi baru.",
    },
    {
      key: "discount.import.maxExpandedBytes",
      value: String(maxExpandedBytes),
      type: "number",
      description:
        "Batas ukuran workbook harga setelah diekspansi (byte). Nilai invalid menolak operasi baru.",
    }
  );

  if (systemConfig.shipment !== undefined) {
    const shipment = asRecord(systemConfig.shipment, "systemConfig.shipment");
    assertKnownKeys(shipment, KNOWN_SHIPMENT_KEYS, "systemConfig.shipment");

    if (shipment.parcelFallback !== undefined) {
      const parcel = asRecord(
        shipment.parcelFallback,
        "systemConfig.shipment.parcelFallback"
      );
      assertKnownKeys(
        parcel,
        PARCEL_KEYS,
        "systemConfig.shipment.parcelFallback"
      );
      const normalized: Record<string, number> = {};
      for (const key of PARCEL_KEYS) {
        normalized[key] = requireNumber(
          parcel[key],
          `systemConfig.shipment.parcelFallback.${key}`
        );
        if (normalized[key] <= 0) {
          refuse(
            "INVALID_CONFIG_VALUE",
            `systemConfig.shipment.parcelFallback.${key} must be greater than 0`
          );
        }
      }
      rows.push({
        key: "shipment.parcelFallback",
        value: JSON.stringify(normalized),
        type: "json",
        description:
          "Fallback parcel per unit untuk quote delivery. Verifikasi terhadap pengukuran SKU aktual sebelum aktivasi.",
      });
    }

    if (shipment.packagingWeightGrams !== undefined) {
      const grams = requirePositiveInteger(
        shipment.packagingWeightGrams,
        "systemConfig.shipment.packagingWeightGrams"
      );
      rows.push({
        key: "shipment.packagingWeightGrams",
        value: String(grams),
        type: "number",
        description:
          "Berat packaging operasional (gram). Verifikasi terhadap packaging aktual sebelum aktivasi delivery.",
      });
    }
  }

  // Checkout starts closed: the storefront is not exposed before the operator
  // explicitly activates it after the launch gate.
  rows.push({
    key: "checkout.paused",
    value: "true",
    type: "string",
    description:
      "Pause darurat checkout. Seed referensi pertama menulis true; aktivasi hanya lewat keputusan operator.",
  });

  return rows;
}

/**
 * Validate and normalize the non-secret production manifest. Unknown keys are
 * refused so a misspelled setting can never be silently ignored, and secret
 * material is refused outright — credentials belong to the environment.
 */
export function validateProductionBootstrapConfig(
  value: unknown
): ProductionBootstrapConfig {
  const manifest = asRecord(value, "manifest");
  assertKnownKeys(manifest, KNOWN_MANIFEST_KEYS, "manifest");

  if (manifest.version !== 1) {
    refuse("INVALID_MANIFEST", "manifest version must be 1");
  }
  if (
    typeof manifest.expectedDatabase !== "string" ||
    manifest.expectedDatabase.trim() === ""
  ) {
    refuse("INVALID_MANIFEST", "manifest expectedDatabase is required");
  }
  const expectedDatabase = manifest.expectedDatabase.trim();
  if (!/^[A-Za-z0-9_][A-Za-z0-9_$-]{0,62}$/.test(expectedDatabase)) {
    refuse(
      "INVALID_MANIFEST",
      "manifest expectedDatabase must be a plain PostgreSQL database name"
    );
  }

  const systemConfig = asRecord(manifest.systemConfig, "manifest.systemConfig");
  assertKnownKeys(systemConfig, KNOWN_SYSTEM_CONFIG_KEYS, "systemConfig");

  return {
    version: 1,
    expectedDatabase,
    systemConfig: buildSystemConfigRows(systemConfig),
  };
}

/** Refuse to act unless the operator declared a production runtime. */
export function assertProductionEnvironment(env: BootstrapEnvironment): void {
  const declared = [env.APP_ENV, env.NODE_ENV]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  if (!declared.includes("production")) {
    refuse(
      "PRODUCTION_ENV_REQUIRED",
      "set APP_ENV=production (or NODE_ENV=production) for a production bootstrap"
    );
  }
}

/**
 * Compare the connected database with the manifest before any write, and
 * require a non-superuser role that can create schema objects.
 */
export function assertTargetIdentity(
  identity: TargetIdentity,
  expectedDatabase: string
): void {
  if (identity.database !== expectedDatabase) {
    refuse(
      "PRODUCTION_TARGET_MISMATCH",
      `connected database does not match the configured production target (expected ${expectedDatabase})`
    );
  }
  if (identity.isSuperuser || !identity.canCreateInPublic) {
    refuse(
      "TARGET_PRIVILEGE_MISMATCH",
      "the production bootstrap role must be a non-superuser with schema create privileges"
    );
  }
}

function readFlagValue(
  argv: readonly string[],
  flag: string
): string | undefined {
  const inline = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (inline !== undefined) {
    const value = inline.slice(flag.length + 1).trim();
    if (value === "") {
      refuse("INVALID_ARGUMENT", `${flag} must not be empty`);
    }
    return value;
  }

  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    refuse("INVALID_ARGUMENT", `${flag} requires a value`);
  }
  return value;
}

/** Parse the production bootstrap CLI arguments; no implicit defaults. */
export function parseProductionBootstrapInput(
  argv: readonly string[],
  env: BootstrapEnvironment
): ProductionBootstrapInput {
  assertProductionEnvironment(env);

  const [subcommandRaw, ...rest] = argv;
  if (
    subcommandRaw === undefined ||
    !SUBCOMMANDS.includes(subcommandRaw as BootstrapSubcommand)
  ) {
    refuse(
      "INVALID_ARGUMENT",
      "usage: production-bootstrap <preflight|seed|verify> --config <file>"
    );
  }
  const subcommand = subcommandRaw as BootstrapSubcommand;

  const knownFlags = new Set<string>(FLAGS);
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (!arg.startsWith("--")) {
      refuse("INVALID_ARGUMENT", `unexpected argument "${arg}"`);
    }
    const hasInlineValue = arg.includes("=");
    const flag = hasInlineValue ? arg.slice(0, arg.indexOf("=")) : arg;
    if (!knownFlags.has(flag)) {
      refuse("INVALID_ARGUMENT", `unknown option "${flag}"`);
    }
    if (!hasInlineValue) {
      // The following token is this flag's value; validated by readFlagValue.
      index++;
    }
  }

  const configPath = readFlagValue(rest, "--config");
  if (configPath === undefined) {
    refuse("INVALID_ARGUMENT", "--config <file> is required");
  }

  const phaseRaw = readFlagValue(rest, "--phase");
  const importReportPath = readFlagValue(rest, "--import-report") ?? null;

  if (subcommand === "preflight") {
    if (phaseRaw === undefined) {
      refuse("INVALID_ARGUMENT", "preflight requires --phase <phase>");
    }
    if (!PHASES.includes(phaseRaw as BootstrapPhase)) {
      refuse(
        "INVALID_ARGUMENT",
        "--phase must be before-migrate or after-migrate"
      );
    }
    if (importReportPath !== null) {
      refuse("INVALID_ARGUMENT", "preflight does not accept --import-report");
    }
    return {
      subcommand,
      configPath,
      phase: phaseRaw as BootstrapPhase,
      importReportPath: null,
    };
  }

  if (phaseRaw !== undefined) {
    refuse("INVALID_ARGUMENT", `${subcommand} does not accept --phase`);
  }

  if (subcommand === "verify") {
    if (importReportPath === null) {
      refuse("INVALID_ARGUMENT", "verify requires --import-report <file>");
    }
  } else if (importReportPath !== null) {
    refuse("INVALID_ARGUMENT", "seed does not accept --import-report");
  }

  return { subcommand, configPath, phase: null, importReportPath };
}
