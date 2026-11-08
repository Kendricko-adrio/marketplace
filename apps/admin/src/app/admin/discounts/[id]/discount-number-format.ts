/** Nilai tampilan terpisah dari payload canonical. Prefix Rp/suffix % dirender oleh input. */
export type NumericInputResult =
  | { status: "valid"; canonical: string | null }
  | { status: "incomplete"; canonical: null }
  | { status: "invalid"; canonical: null; message: string };

const MONEY_MAX = BigInt("9999999999999");
const invalid = (message: string): NumericInputResult => ({ status: "invalid", canonical: null, message });
const incomplete = (): NumericInputResult => ({ status: "incomplete", canonical: null });
const valid = (canonical: string | null): NumericInputResult => ({ status: "valid", canonical });

/** Menerima digit polos atau notasi Indonesia; tidak menebak format asing. */
export function parseMoneyInput(text: string): NumericInputResult {
  if (!text.trim()) return valid(null);
  const value = text.trim().replace(/^Rp\s*/i, "");
  if (!value || value.length > 64) return invalid("Gunakan format seperti Rp 100.000,00");
  const whole = "(?:\\d+|\\d{1,3}(?:\\.\\d{3})+)";
  if (new RegExp(`^${whole},$`).test(value) || /^\d{1,3}(?:\.\d{3})*\.\d{0,2}$/.test(value)) {
    return incomplete();
  }
  if (!new RegExp(`^${whole}(?:,\\d{1,2})?$`).test(value)) {
    return invalid("Gunakan format seperti Rp 100.000,00");
  }
  const [integer, fraction = ""] = value.split(",");
  if (/[^0]/.test(fraction)) return invalid("Masukkan nominal dalam Rupiah utuh");
  const amount = BigInt(integer.replace(/\./g, ""));
  if (amount > MONEY_MAX) return invalid("Nominal maksimal Rp 9.999.999.999.999,00");
  return valid(amount.toString());
}

/** Bagian editable saja; caller menampilkan prefix Rp yang selalu terlihat. */
export function formatMoneyInput(canonical: string | null, focused: boolean): string {
  if (canonical === null) return "";
  const grouped = canonical.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return focused ? grouped : `${grouped},00`;
}

export function parsePercentInput(text: string): NumericInputResult {
  if (!text.trim()) return valid(null);
  const value = text.trim().replace(/%$/, "").trim();
  if (/^\d{1,3},$/.test(value)) return incomplete();
  if (/^\d+,\d{7,}$/.test(value)) return invalid("Maksimal 6 angka desimal");
  if (!/^\d{1,3}(?:,\d{1,6})?$/.test(value)) {
    return invalid("Masukkan persentase lebih dari 0 hingga 100%");
  }
  const [whole, fraction = ""] = value.split(",");
  const scaled = BigInt(whole) * BigInt(1000000) + BigInt(fraction.padEnd(6, "0"));
  if (scaled <= BigInt(0) || scaled > BigInt(100000000)) return invalid("Masukkan persentase lebih dari 0 hingga 100%");
  const trimmed = fraction.replace(/0+$/, "");
  return valid(BigInt(whole).toString() + (trimmed ? `.${trimmed}` : ""));
}

/** Bagian editable saja; caller menampilkan suffix % yang selalu terlihat. */
export function formatPercentInput(canonical: string | null): string {
  return canonical === null ? "" : canonical.replace(".", ",");
}
