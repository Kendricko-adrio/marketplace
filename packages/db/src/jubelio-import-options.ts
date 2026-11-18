export type JubelioImportOptions = {
  itemName?: string;
  preserveBranchHours?: boolean;
  full: boolean;
  expectedDatabase?: string;
  reportFile?: string;
};

export type JubelioImportEnvironment = Record<string, string | undefined>;

export type FullJubelioImportOptions = {
  mode: "full";
  expectedDatabase: string;
  reportFile: string;
  pageSize: number;
};

/** Page size used by the bootstrap full pull (existing CLI default). */
export const FULL_IMPORT_PAGE_SIZE = 200;

type NamedMaster = {
  item_name: string;
};

function readInlineFlag(
  argv: readonly string[],
  flag: string
): string | undefined {
  const arg = argv.find((candidate) => candidate.startsWith(`${flag}=`));
  if (!arg) return undefined;
  return arg.slice(flag.length + 1).trim();
}

export function parseJubelioImportArgs(
  argv: readonly string[]
): JubelioImportOptions {
  const options: JubelioImportOptions = {
    full: argv.includes("--full"),
  };
  if (argv.includes("--preserve-branch-hours")) options.preserveBranchHours = true;

  const expectedDatabase = readInlineFlag(argv, "--expected-database");
  if (expectedDatabase !== undefined) {
    if (!expectedDatabase) {
      throw new Error("--expected-database must not be empty");
    }
    options.expectedDatabase = expectedDatabase;
  }

  const reportFile = readInlineFlag(argv, "--report-file");
  if (reportFile !== undefined) {
    if (!reportFile) {
      throw new Error("--report-file must not be empty");
    }
    options.reportFile = reportFile;
  }

  const itemNameArg = argv.find((arg) => arg.startsWith("--item-name="));
  if (itemNameArg) {
    const itemName = itemNameArg.slice("--item-name=".length).trim();
    if (!itemName) throw new Error("--item-name must not be empty");
    options.itemName = itemName;
  }

  return options;
}

export function parseJubelioMaxProducts(value: string | undefined): number {
  const raw = (value || "").trim();
  if (!raw) return Infinity;

  const cap = Math.max(0, Number(raw));
  if (!Number.isFinite(cap)) {
    throw new Error(
      `JUBELIO_SYNC_MAX_PRODUCTS must be a number or empty (got "${raw}")`
    );
  }
  return cap;
}

/**
 * Validate the full-bootstrap scope. A full pull must read every page from page
 * one without an exact-name filter or a development cap; anything else is
 * refused before a single provider request or database write.
 *
 * Returns `null` for the untouched filtered/dev import contract.
 */
export function validateFullJubelioImportOptions(
  options: JubelioImportOptions,
  env: JubelioImportEnvironment
): FullJubelioImportOptions | null {
  if (!options.full) return null;

  if (options.itemName) {
    throw new Error(
      "--full cannot be combined with --item-name: a full bootstrap import reads every product"
    );
  }

  const cap = parseJubelioMaxProducts(env.JUBELIO_SYNC_MAX_PRODUCTS);
  if (cap !== Infinity) {
    throw new Error(
      `--full refuses JUBELIO_SYNC_MAX_PRODUCTS (got "${env.JUBELIO_SYNC_MAX_PRODUCTS}")`
    );
  }

  const startPageRaw = (env.JUBELIO_SYNC_START_PAGE ?? "").trim();
  if (startPageRaw) {
    const page = Number(startPageRaw);
    if (!Number.isInteger(page) || page < 1) {
      throw new Error(
        `JUBELIO_SYNC_START_PAGE must be a positive integer (got "${startPageRaw}")`
      );
    }
    if (page !== 1) {
      throw new Error(
        `--full must start at page 1; JUBELIO_SYNC_START_PAGE=${startPageRaw} is refused`
      );
    }
  }

  if (!options.expectedDatabase) {
    throw new Error("--full requires --expected-database <name>");
  }
  if (!options.reportFile) {
    throw new Error("--full requires --report-file <path>");
  }

  return {
    mode: "full",
    expectedDatabase: options.expectedDatabase,
    reportFile: options.reportFile,
    pageSize: FULL_IMPORT_PAGE_SIZE,
  };
}

export function filterExactItemNameMatches<T extends NamedMaster>(
  masters: T[],
  itemName: string
): T[] {
  const expected = itemName.trim().toLocaleLowerCase();
  return masters.filter(
    (master) => master.item_name.trim().toLocaleLowerCase() === expected
  );
}
