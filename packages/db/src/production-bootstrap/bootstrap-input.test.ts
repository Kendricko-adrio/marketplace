import { describe, expect, it } from "vitest";

import {
  ProductionBootstrapInputError,
  assertProductionEnvironment,
  assertTargetIdentity,
  parseProductionBootstrapInput,
  validateProductionBootstrapConfig,
} from "./bootstrap-input";

// Expected values below are transcribed from the approved plan
// (`.scratch/production-deployment/plan/first-production-deployment.md` §5–§6),
// never recomputed from the implementation.

const PRODUCTION_ENV = { APP_ENV: "production" };

const VALID_MANIFEST = {
  version: 1,
  expectedDatabase: "qadfstore_production",
  systemConfig: {
    reservationTtlMinutes: 15,
    taxPpnRatePercent: 11,
    discountsContractVersion: 1,
    jubelioSalesTaxId: -2,
    discountImport: {
      maxRows: 1000,
      maxFileBytes: 5242880,
      maxExpandedBytes: 26214400,
    },
    shipment: {
      parcelFallback: { weight: 250, length: 30, width: 20, height: 10 },
      packagingWeightGrams: 15,
    },
  },
};

function rowsOf(config: ReturnType<typeof validateProductionBootstrapConfig>) {
  return Object.fromEntries(
    config.systemConfig.map((row) => [row.key, row.value])
  );
}

function expectCode(run: () => unknown, code: string) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ProductionBootstrapInputError);
    expect((error as ProductionBootstrapInputError).code).toBe(code);
    return;
  }
  throw new Error(`expected ProductionBootstrapInputError(${code})`);
}

describe("production bootstrap manifest", () => {
  it("normalizes the approved non-secret reference rows", () => {
    const config = validateProductionBootstrapConfig(VALID_MANIFEST);

    expect(config.version).toBe(1);
    expect(config.expectedDatabase).toBe("qadfstore_production");
    expect(rowsOf(config)).toEqual({
      "reservation.ttlMinutes": "15",
      "tax.ppnRatePercent": "11",
      "discounts.contractVersion": "1",
      "jubelio.salesTaxId": "-2",
      "discount.import.maxRows": "1000",
      "discount.import.maxFileBytes": "5242880",
      "discount.import.maxExpandedBytes": "26214400",
      "shipment.parcelFallback":
        '{"weight":250,"length":30,"width":20,"height":10}',
      "shipment.packagingWeightGrams": "15",
      "checkout.paused": "true",
    });
    // The bootstrap marker is owned by the seeder, never by the manifest.
    expect(rowsOf(config)).not.toHaveProperty(
      "production.bootstrapReferenceVersion"
    );
  });

  it("applies the documented operational defaults when optional import limits are absent", () => {
    const config = validateProductionBootstrapConfig({
      version: 1,
      expectedDatabase: "qadfstore_production",
      systemConfig: {
        reservationTtlMinutes: 15,
        taxPpnRatePercent: 11,
        discountsContractVersion: 0,
      },
    });

    expect(rowsOf(config)).toMatchObject({
      "discount.import.maxRows": "1000",
      "discount.import.maxFileBytes": "5242880",
      "discount.import.maxExpandedBytes": "26214400",
      "checkout.paused": "true",
    });
    // No demo/tenant-specific values are invented.
    expect(rowsOf(config)).not.toHaveProperty("jubelio.salesTaxId");
    expect(rowsOf(config)).not.toHaveProperty("shipment.parcelFallback");
    expect(rowsOf(config)).not.toHaveProperty(
      "shipment.packagingWeightGrams"
    );
  });

  it("refuses a manifest that omits the tax policy instead of assuming 11 percent", () => {
    expectCode(
      () =>
        validateProductionBootstrapConfig({
          version: 1,
          expectedDatabase: "qadfstore_production",
          systemConfig: {
            reservationTtlMinutes: 15,
            discountsContractVersion: 1,
          },
        }),
      "MISSING_REQUIRED_CONFIG"
    );
  });

  it("refuses a manifest without an explicit discount contract version", () => {
    expectCode(
      () =>
        validateProductionBootstrapConfig({
          version: 1,
          expectedDatabase: "qadfstore_production",
          systemConfig: {
            reservationTtlMinutes: 15,
            taxPpnRatePercent: 11,
          },
        }),
      "MISSING_REQUIRED_CONFIG"
    );
  });

  it.each([
    [{ reservationTtlMinutes: 0, taxPpnRatePercent: 11, discountsContractVersion: 1 }, "INVALID_CONFIG_VALUE"],
    [{ reservationTtlMinutes: 15, taxPpnRatePercent: 0, discountsContractVersion: 1 }, "INVALID_CONFIG_VALUE"],
    [{ reservationTtlMinutes: 15, taxPpnRatePercent: 11, discountsContractVersion: 2 }, "INVALID_CONFIG_VALUE"],
    [{ reservationTtlMinutes: 15, taxPpnRatePercent: 11, discountsContractVersion: 1, jubelioSalesTaxId: 0 }, "INVALID_CONFIG_VALUE"],
    [
      {
        reservationTtlMinutes: 15,
        taxPpnRatePercent: 11,
        discountsContractVersion: 1,
        discountImport: { maxRows: 1000, maxFileBytes: 5242880, maxExpandedBytes: 1024 },
      },
      "INVALID_CONFIG_VALUE",
    ],
  ])("refuses an invalid config value %j", (systemConfig, code) => {
    expectCode(
      () =>
        validateProductionBootstrapConfig({
          version: 1,
          expectedDatabase: "qadfstore_production",
          systemConfig,
        }),
      code
    );
  });

  it("refuses unknown keys so a misspelled setting cannot silently pass", () => {
    expectCode(
      () =>
        validateProductionBootstrapConfig({
          ...VALID_MANIFEST,
          expectedDatabse: "qadfstore_production",
        }),
      "UNKNOWN_MANIFEST_KEY"
    );
    expectCode(
      () =>
        validateProductionBootstrapConfig({
          version: 1,
          expectedDatabase: "qadfstore_production",
          systemConfig: {
            reservationTtlMinutes: 15,
            taxPpnRatePercent: 11,
            discountsContractVersion: 1,
            reservationTTLMinutes: 30,
          },
        }),
      "UNKNOWN_MANIFEST_KEY"
    );
  });

  it("refuses credentials or connection strings inside the manifest", () => {
    expectCode(
      () =>
        validateProductionBootstrapConfig({
          version: 1,
          expectedDatabase: "qadfstore_production",
          systemConfig: {
            reservationTtlMinutes: 15,
            taxPpnRatePercent: 11,
            discountsContractVersion: 1,
            jubelioPassword: "secret",
          },
        }),
      "SECRET_IN_MANIFEST"
    );
  });

  it("refuses a manifest version it does not know", () => {
    expectCode(
      () => validateProductionBootstrapConfig({ ...VALID_MANIFEST, version: 2 }),
      "INVALID_MANIFEST"
    );
  });
});

describe("production bootstrap argv", () => {
  it("parses the preflight phase", () => {
    expect(
      parseProductionBootstrapInput(
        [
          "preflight",
          "--config",
          "/srv/bootstrap/bootstrap.config.json",
          "--phase",
          "before-migrate",
        ],
        PRODUCTION_ENV
      )
    ).toEqual({
      subcommand: "preflight",
      configPath: "/srv/bootstrap/bootstrap.config.json",
      phase: "before-migrate",
      importReportPath: null,
    });
  });

  it("parses seed and verify without a phase", () => {
    expect(
      parseProductionBootstrapInput(
        [
          "seed",
          "--config",
          "/srv/bootstrap/bootstrap.config.json",
        ],
        PRODUCTION_ENV
      )
    ).toEqual({
      subcommand: "seed",
      configPath: "/srv/bootstrap/bootstrap.config.json",
      phase: null,
      importReportPath: null,
    });

    expect(
      parseProductionBootstrapInput(
        [
          "verify",
          "--config",
          "/srv/bootstrap/bootstrap.config.json",
          "--import-report",
          "/home/ops/log/marketplace-bootstrap/production/import.json",
        ],
        PRODUCTION_ENV
      )
    ).toEqual({
      subcommand: "verify",
      configPath: "/srv/bootstrap/bootstrap.config.json",
      phase: null,
      importReportPath:
        "/home/ops/log/marketplace-bootstrap/production/import.json",
    });
  });

  it.each([
    [["preflight", "--config", "/c.json"], "INVALID_ARGUMENT"],
    [["seed", "--config", "/c.json", "--phase", "after-migrate"], "INVALID_ARGUMENT"],
    [["verify", "--config", "/c.json"], "INVALID_ARGUMENT"],
    [["seed"], "INVALID_ARGUMENT"],
    [["migrate", "--config", "/c.json"], "INVALID_ARGUMENT"],
    [["seed", "--config", "/c.json", "--force"], "INVALID_ARGUMENT"],
    [["preflight", "--config", "/c.json", "--phase", "during"], "INVALID_ARGUMENT"],
  ])("refuses %j", (argv, code) => {
    expectCode(
      () => parseProductionBootstrapInput(argv as string[], PRODUCTION_ENV),
      code
    );
  });

  it("refuses to run without an explicit production environment", () => {
    expectCode(
      () =>
        parseProductionBootstrapInput(
          ["seed", "--config", "/c.json"],
          { APP_ENV: "staging", NODE_ENV: "development" }
        ),
      "PRODUCTION_ENV_REQUIRED"
    );
    expectCode(
      () => assertProductionEnvironment({ NODE_ENV: "test" }),
      "PRODUCTION_ENV_REQUIRED"
    );
    expect(() =>
      assertProductionEnvironment({ APP_ENV: "production" })
    ).not.toThrow();
    expect(() =>
      assertProductionEnvironment({ NODE_ENV: "production" })
    ).not.toThrow();
  });
});

describe("production target guard", () => {
  const identity = {
    database: "qadfstore_production",
    role: "qmarketplace_production",
    isSuperuser: false,
    canCreateInPublic: true,
  };

  it("accepts the expected non-superuser target", () => {
    expect(() =>
      assertTargetIdentity(identity, "qadfstore_production")
    ).not.toThrow();
  });

  it("refuses a different database before any write", () => {
    expectCode(
      () => assertTargetIdentity({ ...identity, database: "qadfstore" }, "qadfstore_production"),
      "PRODUCTION_TARGET_MISMATCH"
    );
  });

  it("refuses a superuser role and a role without schema privileges", () => {
    expectCode(
      () => assertTargetIdentity({ ...identity, isSuperuser: true }, "qadfstore_production"),
      "TARGET_PRIVILEGE_MISMATCH"
    );
    expectCode(
      () =>
        assertTargetIdentity(
          { ...identity, canCreateInPublic: false },
          "qadfstore_production"
        ),
      "TARGET_PRIVILEGE_MISMATCH"
    );
  });
});
