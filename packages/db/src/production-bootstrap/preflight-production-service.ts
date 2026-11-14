// One-operation preflight: read-only checks before and after migration.
// It refuses a wrong target, a schema without a trustworthy migration history,
// and a release whose schema contract is not present — before any write.

import {
  assertTargetIdentity,
  type BootstrapPhase,
  type ProductionBootstrapConfig,
} from "./bootstrap-input";
import {
  inspectMigrationState,
  inspectSchemaContract,
  readTargetIdentity,
  type BootstrapDb,
  type ReleaseMigration,
} from "./production-bootstrap-repository";

export interface PreflightInput {
  phase: BootstrapPhase;
  config: ProductionBootstrapConfig;
  migrations: readonly ReleaseMigration[];
}

export interface PreflightDependencies {
  db: BootstrapDb;
}

export interface PreflightCheck {
  id: string;
  ok: boolean;
  detail: string | null;
}

export interface PreflightReport {
  code: "PREFLIGHT_OK" | "PREFLIGHT_REFUSED";
  phase: BootstrapPhase;
  database: string;
  role: string;
  checks: PreflightCheck[];
}

export async function preflightProduction(
  input: PreflightInput,
  dependencies: PreflightDependencies
): Promise<PreflightReport> {
  const { db } = dependencies;
  const identity = await readTargetIdentity(db);
  assertTargetIdentity(identity, input.config.expectedDatabase);

  const migrationState = await inspectMigrationState(db, input.migrations);
  const checks: PreflightCheck[] = [];

  if (input.phase === "before-migrate") {
    const schemaWithoutHistory =
      !migrationState.journalPresent &&
      migrationState.appTablesPresent.length > 0;
    checks.push({
      id: "MIGRATION_HISTORY_TRUSTWORTHY",
      ok:
        !schemaWithoutHistory &&
        migrationState.unknownAppliedHashes.length === 0,
      detail: schemaWithoutHistory
        ? `application tables exist without a migration journal (${migrationState.appTablesPresent.join(", ")}); audit manually`
        : migrationState.unknownAppliedHashes.length > 0
          ? `${migrationState.unknownAppliedHashes.length} applied migration hash(es) are not part of this release`
          : null,
    });
  } else {
    checks.push(
      {
        id: "MIGRATION_HISTORY_PRESENT",
        ok: migrationState.journalPresent,
        detail: migrationState.journalPresent
          ? null
          : "migration journal is missing; run the release migration before the after-migrate preflight",
      },
      {
        id: "MIGRATION_HISTORY_COMPLETE",
        ok:
          migrationState.missingTags.length === 0 &&
          migrationState.unknownAppliedHashes.length === 0,
        detail:
          migrationState.missingTags.length > 0
            ? `${migrationState.missingTags.length} release migration(s) are not applied`
            : migrationState.unknownAppliedHashes.length > 0
              ? `${migrationState.unknownAppliedHashes.length} applied migration hash(es) are not part of this release`
              : null,
      }
    );

    const missingObjects = await inspectSchemaContract(db);
    checks.push({
      id: "SCHEMA_CONTRACT",
      ok: missingObjects.length === 0,
      detail:
        missingObjects.length === 0
          ? null
          : `missing schema objects: ${missingObjects.join(", ")}`,
    });
  }

  const ok = checks.every((check) => check.ok);
  return {
    code: ok ? "PREFLIGHT_OK" : "PREFLIGHT_REFUSED",
    phase: input.phase,
    database: identity.database,
    role: identity.role,
    checks,
  };
}
