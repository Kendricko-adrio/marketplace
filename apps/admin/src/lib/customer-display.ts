export type SearchableCustomer = {
  name: string;
  email: string;
  phone: string | null;
};

export function filterCustomers<T extends SearchableCustomer>(
  customers: T[],
  query: string
): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("id-ID");
  if (!normalizedQuery) return customers;

  return customers.filter((customer) =>
    [customer.name, customer.email, customer.phone]
      .filter((value): value is string => Boolean(value))
      .some((value) =>
        value.toLocaleLowerCase("id-ID").includes(normalizedQuery)
      )
  );
}

export function getCustomerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
}

export function formatCustomerDate(
  value: string | Date | null,
  kind: "date" | "datetime" = "datetime"
): string {
  if (!value) return "—";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(kind === "datetime"
      ? { hour: "2-digit", minute: "2-digit", hour12: false }
      : {}),
  }).format(date);
}
