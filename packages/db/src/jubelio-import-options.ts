export type JubelioImportOptions = {
  itemName?: string;
};

type NamedMaster = {
  item_name: string;
};

export function parseJubelioImportArgs(argv: string[]): JubelioImportOptions {
  const itemNameArg = argv.find((arg) => arg.startsWith("--item-name="));
  if (!itemNameArg) return {};

  const itemName = itemNameArg.slice("--item-name=".length).trim();
  if (!itemName) throw new Error("--item-name must not be empty");

  return { itemName };
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

export function filterExactItemNameMatches<T extends NamedMaster>(
  masters: T[],
  itemName: string
): T[] {
  const expected = itemName.trim().toLocaleLowerCase();
  return masters.filter(
    (master) => master.item_name.trim().toLocaleLowerCase() === expected
  );
}
