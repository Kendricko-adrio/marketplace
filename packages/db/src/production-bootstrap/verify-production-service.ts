// One-operation verification: schema, reference data, Owner, imported catalog
// and full-import report. A passing run is `BOOTSTRAP_VERIFIED` — it is not
// permission to enable checkout or open the storefront; those remain separate
// launch blockers reported alongside.

import {
  CONTRACT_CONFIG_KEYS,
  REFERENCE_MARKER_KEY,
  REFERENCE_MARKER_VERSION,
  assertTargetIdentity,
  type BootstrapEnvironment,
  type ProductionBootstrapConfig,
} from "./bootstrap-input";
import {
  inspectMigrationState,
  inspectSchemaContract,
  readProductionVerificationState,
  readTargetIdentity,
  type BootstrapDb,
  type ReleaseMigration,
} from "./production-bootstrap-repository";
import { IMPORT_REPORT_FORMAT_VERSION } from "../jubelio-import-report";

export interface VerifyProductionInput {
  config: ProductionBootstrapConfig;
  migrations: readonly ReleaseMigration[];
  importReport: unknown;
  environment: BootstrapEnvironment;
}

export interface VerifyProductionDependencies {
  db: BootstrapDb;
}

export interface VerificationCheck {
  id: string;
  ok: boolean;
  detail: string | null;
}

export interface VerificationReport {
  code: "BOOTSTRAP_VERIFIED" | "BOOTSTRAP_INCOMPLETE";
  database: string;
  role: string;
  checks: VerificationCheck[];
  launchBlockers: string[];
}

const REQUIRED_ROLE_KEYS = ["system_owner", "hq", "admin"] as const;

function parseConfigValue(
  row: { value: string; type: string } | undefined,
  type: "number" | "json" | "string"
): { ok: boolean; detail: string | null } {
  if (!row) return { ok: false, detail: "missing" };
  if (row.type !== type) {
    return { ok: false, detail: `expected type ${type}, found ${row.type}` };
  }
  if (type === "number") {
    return Number.isFinite(Number(row.value.trim()))
      ? { ok: true, detail: null }
      : { ok: false, detail: "value is not a finite number" };
  }
  if (type === "json") {
    try {
      JSON.parse(row.value);
      return { ok: true, detail: null };
    } catch {
      return { ok: false, detail: "value is not valid JSON" };
    }
  }
  return { ok: true, detail: null };
}

function sameIdSet(left: readonly number[], right: readonly number[]): boolean {
  const a = [...new Set(left)].sort((x, y) => x - y);
  const b = [...new Set(right)].sort((x, y) => x - y);
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function hasEnv(env: BootstrapEnvironment, key: string): boolean {
  const value = env[key];
  return typeof value === "string" && value.trim() !== "";
}

function missingAny(env: BootstrapEnvironment, keys: string[]): boolean {
  return keys.some((key) => !hasEnv(env, key));
}

export async function verifyProductionBootstrap(
  input: VerifyProductionInput,
  dependencies: VerifyProductionDependencies
): Promise<VerificationReport> {
  const { db } = dependencies;
  const identity = await readTargetIdentity(db);
  assertTargetIdentity(identity, input.config.expectedDatabase);

  const state = await readProductionVerificationState(db);
  const migrationState = await inspectMigrationState(db, input.migrations);
  const missingObjects = await inspectSchemaContract(db);

  const checks: VerificationCheck[] = [];

  checks.push({
    id: "MIGRATION_HISTORY_COMPLETE",
    ok:
      migrationState.journalPresent &&
      migrationState.missingTags.length === 0 &&
      migrationState.unknownAppliedHashes.length === 0,
    detail:
      migrationState.missingTags.length > 0
        ? `${migrationState.missingTags.length} release migration(s) are not applied`
        : !migrationState.journalPresent
          ? "migration journal is missing"
          : migrationState.unknownAppliedHashes.length > 0
            ? `${migrationState.unknownAppliedHashes.length} applied migration hash(es) are not part of this release`
            : null,
  });

  checks.push({
    id: "SCHEMA_CONTRACT",
    ok: missingObjects.length === 0,
    detail:
      missingObjects.length === 0
        ? null
        : `missing schema objects: ${missingObjects.join(", ")}`,
  });

  const marker = state.markerValue?.trim() ?? null;
  checks.push({
    id: "REFERENCE_MARKER",
    ok: marker === String(REFERENCE_MARKER_VERSION),
    detail:
      marker === String(REFERENCE_MARKER_VERSION)
        ? null
        : marker === null
          ? `${REFERENCE_MARKER_KEY} is missing`
          : `unexpected marker version ${marker}`,
  });

  const missingRoles = REQUIRED_ROLE_KEYS.filter(
    (key) => !state.roleKeys.includes(key)
  );
  checks.push({
    id: "INITIAL_ROLES",
    ok: missingRoles.length === 0,
    detail: missingRoles.length === 0 ? null : `missing roles: ${missingRoles.join(", ")}`,
  });

  checks.push({
    id: "HQ_BRANCH",
    ok: state.hqBranchPresent,
    detail: state.hqBranchPresent ? null : "the local HQ branch is missing",
  });

  const configProblems: string[] = [];
  for (const row of input.config.systemConfig) {
    if (row.key === "checkout.paused") continue;
    const problem = parseConfigValue(state.config[row.key], row.type);
    if (!problem.ok) configProblems.push(`${row.key}: ${problem.detail}`);
  }
  checks.push({
    id: "SYSTEM_CONFIG",
    ok: configProblems.length === 0,
    detail: configProblems.length === 0 ? null : configProblems.join("; "),
  });

  const contractDrift = CONTRACT_CONFIG_KEYS.filter((key) => {
    const row = input.config.systemConfig.find((entry) => entry.key === key);
    if (!row) return false;
    const existing = state.config[key];
    return existing === undefined || existing.value !== row.value;
  });
  checks.push({
    id: "CONTRACT_CONFIG",
    ok: contractDrift.length === 0,
    detail:
      contractDrift.length === 0
        ? null
        : `contract config differs from the manifest: ${contractDrift.join(", ")}`,
  });

  checks.push({
    id: "SYSTEM_OWNER",
    ok: state.systemOwnerCount > 0 && state.ownersMissingCredential === 0,
    detail:
      state.systemOwnerCount === 0
        ? "no System Owner exists"
        : state.ownersMissingCredential > 0
          ? `${state.ownersMissingCredential} System Owner(s) have no credential account`
          : null,
  });

  const report = input.importReport as
    | {
        formatVersion?: unknown;
        status?: unknown;
        finishedAt?: unknown;
        database?: unknown;
        counts?: {
          sourceProductGroups?: unknown;
          sourceSkus?: unknown;
          databaseProductGroups?: unknown;
          databaseSkus?: unknown;
          stockPairsCovered?: unknown;
        };
        source?: { productGroupIds?: unknown; skuIds?: unknown };
      }
    | null
    | undefined;

  const reportCounts = report?.counts;
  const sourceIds = report?.source;
  const reportGroups = Array.isArray(sourceIds?.productGroupIds)
    ? (sourceIds.productGroupIds as unknown[]).filter(
        (value): value is number => typeof value === "number"
      )
    : null;
  const reportSkus = Array.isArray(sourceIds?.skuIds)
    ? (sourceIds.skuIds as unknown[]).filter(
        (value): value is number => typeof value === "number"
      )
    : null;

  const importProblems: string[] = [];
  if (!report || typeof report !== "object") {
    importProblems.push("report is missing or unreadable");
  } else {
    if (report.formatVersion !== IMPORT_REPORT_FORMAT_VERSION) {
      importProblems.push("unknown report format version");
    }
    if (report.status !== "complete") {
      importProblems.push(`report status is ${String(report.status)}`);
    }
    if (report.finishedAt == null) {
      importProblems.push("report has no finishedAt");
    }
    if (report.database !== input.config.expectedDatabase) {
      importProblems.push("report belongs to a different database");
    }
    if (reportCounts?.databaseProductGroups !== state.productGroups) {
      importProblems.push(
        `database product group count changed since the reported run (${state.productGroups})`
      );
    }
    if (reportCounts?.databaseSkus !== state.skus) {
      importProblems.push(
        `database SKU count changed since the reported run (${state.skus})`
      );
    }
    if (reportGroups === null || !sameIdSet(reportGroups, state.productGroupIds)) {
      importProblems.push(
        "database product group ids do not match the reported source set"
      );
    }
    if (reportSkus === null || !sameIdSet(reportSkus, state.skuIds)) {
      importProblems.push(
        "database SKU ids do not match the reported source set"
      );
    }
    if (reportCounts?.stockPairsCovered !== state.stockPairsCovered) {
      importProblems.push(
        `reported stock coverage differs from the database (${state.stockPairsCovered})`
      );
    }
  }
  if (state.productGroups === 0 || state.skus === 0) {
    importProblems.push("the database carries no Jubelio-mapped catalog");
  }
  checks.push({
    id: "FULL_IMPORT",
    ok: importProblems.length === 0,
    detail: importProblems.length === 0 ? null : importProblems.join("; "),
  });

  checks.push({
    id: "STOCK_INVARIANTS",
    ok: state.negativeHolds === 0 && state.providerBranches > 0,
    detail:
      state.negativeHolds > 0
        ? `${state.negativeHolds} branch stock row(s) have a negative local hold`
        : state.providerBranches === 0
          ? "no Jubelio-mapped branch exists"
          : null,
  });

  const coverageProblems: string[] = [];
  if (state.stockPairsPossible === 0) {
    coverageProblems.push(
      "no SKU/branch stock pair can be derived from the mapped catalog"
    );
  } else if (state.stockPairsCovered !== state.stockPairsPossible) {
    coverageProblems.push(
      `stock coverage ${state.stockPairsCovered}/${state.stockPairsPossible} mapped SKU/branch pairs`
    );
  }
  if (state.stockRowsMissingTimestamp > 0) {
    coverageProblems.push(
      `${state.stockRowsMissingTimestamp} covered pair(s) have no provider observation timestamp`
    );
  }
  checks.push({
    id: "STOCK_COVERAGE",
    ok: coverageProblems.length === 0,
    detail: coverageProblems.length === 0 ? null : coverageProblems.join("; "),
  });

  const env = input.environment;
  const launchBlockers: string[] = [];
  if (state.config["checkout.paused"]?.value !== "true") {
    launchBlockers.push(
      "CHECKOUT_PAUSE_NOT_SET: checkout.paused is not true; keep checkout closed until the launch gate passes"
    );
  }
  if (!state.config["jubelio.salesTaxId"]) {
    launchBlockers.push(
      "TAX_MASTER_MISSING: jubelio.salesTaxId is not configured; verify the tenant tax master before enabling checkout"
    );
  }
  if (!state.config["shipment.parcelFallback"] || !state.config["shipment.packagingWeightGrams"]) {
    launchBlockers.push(
      "SHIPMENT_PARAMETERS_MISSING: parcel fallback/packaging weight are not configured; delivery stays disabled"
    );
  }
  if (state.config["discounts.contractVersion"]?.value === "0") {
    launchBlockers.push(
      "DISCOUNT_CONTRACT_V0: discounts.contractVersion is 0; the current checkout contract is not active"
    );
  }
  if (missingAny(env, ["JUBELIO_PAYMENT_ACCOUNT_ID", "JUBELIO_PAYMENT_TYPE"])) {
    launchBlockers.push(
      "SETTLEMENT_CONFIG_MISSING: JUBELIO_PAYMENT_ACCOUNT_ID/JUBELIO_PAYMENT_TYPE are not both set"
    );
  }
  if (missingAny(env, ["MIDTRANS_SERVER_KEY", "MIDTRANS_CLIENT_KEY"])) {
    launchBlockers.push("PAYMENT_CONFIG_MISSING: Midtrans keys are not set");
  }
  if (missingAny(env, ["SMTP_USER", "SMTP_PASS", "SMTP_FROM"])) {
    launchBlockers.push("EMAIL_CONFIG_MISSING: SMTP settings are not set");
  }
  if (missingAny(env, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"])) {
    launchBlockers.push("OAUTH_CONFIG_MISSING: Google OAuth settings are not set");
  }
  if (missingAny(env, ["CRON_SECRET"])) {
    launchBlockers.push("CRON_SECRET_MISSING: reservation sweep/cron endpoints are not configured");
  }
  if (env.JUBELIO_STOCK_WRITES_ENABLED !== "true") {
    launchBlockers.push(
      "STOCK_WRITES_DISABLED: JUBELIO_STOCK_WRITES_ENABLED is not true; checkout cannot adjust provider stock"
    );
  }
  if (state.oldestStockSyncedAt !== null) {
    const maxAgeMinutes = Number(env.BOOTSTRAP_STOCK_MAX_AGE_MINUTES ?? "1440");
    const ageMinutes =
      (Date.now() - Date.parse(state.oldestStockSyncedAt)) / 60_000;
    if (
      Number.isFinite(maxAgeMinutes) &&
      maxAgeMinutes > 0 &&
      ageMinutes > maxAgeMinutes
    ) {
      launchBlockers.push(
        `STOCK_OBSERVATION_STALE: oldest provider stock observation is ${Math.round(ageMinutes)} minutes old (threshold ${maxAgeMinutes}); re-import before enabling checkout`
      );
    }
  }

  const ok = checks.every((check) => check.ok);
  return {
    code: ok ? "BOOTSTRAP_VERIFIED" : "BOOTSTRAP_INCOMPLETE",
    database: identity.database,
    role: identity.role,
    checks,
    launchBlockers,
  };
}
