// One-operation reference seed for a fresh production database.
// The service owns the decision; the repository owns the transaction, advisory
// lock and writes. Nothing here creates users, customers or catalog rows.

import {
  assertTargetIdentity,
  type ProductionBootstrapConfig,
} from "./bootstrap-input";
import {
  initializeProductionReferences,
  readTargetIdentity,
  type BootstrapDb,
  type ReferenceSeedResult,
} from "./production-bootstrap-repository";

export interface SeedProductionInput {
  config: ProductionBootstrapConfig;
}

export interface SeedProductionDependencies {
  db: BootstrapDb;
}

export interface SeedProductionResult {
  code:
    | "REFERENCE_SEED_APPLIED"
    | "REFERENCE_SEED_ALREADY_APPLIED"
    | "REFERENCE_SEED_REFUSED";
  database: string;
  role: string;
  marker: number | null;
  written: {
    roles: number;
    grants: number;
    branches: number;
    configRows: number;
  } | null;
  preservedConfigKeys: string[];
  refusal: {
    code: NonNullable<
      Extract<ReferenceSeedResult, { kind: "refused" }>["code"]
    >;
    message: string;
    keys: string[];
  } | null;
}

export async function seedProductionReferenceData(
  input: SeedProductionInput,
  dependencies: SeedProductionDependencies
): Promise<SeedProductionResult> {
  const { db } = dependencies;
  const identity = await readTargetIdentity(db);
  assertTargetIdentity(identity, input.config.expectedDatabase);

  const result = await initializeProductionReferences(db, input.config);

  if (result.kind === "refused") {
    return {
      code: "REFERENCE_SEED_REFUSED",
      database: identity.database,
      role: identity.role,
      marker: null,
      written: null,
      preservedConfigKeys: [],
      refusal: {
        code: result.code,
        message: result.message,
        keys: result.keys,
      },
    };
  }

  if (result.kind === "already-applied") {
    return {
      code: "REFERENCE_SEED_ALREADY_APPLIED",
      database: identity.database,
      role: identity.role,
      marker: result.marker,
      written: null,
      preservedConfigKeys: [],
      refusal: null,
    };
  }

  return {
    code: "REFERENCE_SEED_APPLIED",
    database: identity.database,
    role: identity.role,
    marker: result.marker,
    written: result.written,
    preservedConfigKeys: result.preservedConfigKeys,
    refusal: null,
  };
}
