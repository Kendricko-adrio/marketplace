import "server-only";

import { count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { clients, db, orders } from "@/db";
import type { CustomerListItem } from "@/lib/customers";

export type CustomerListQuery = { page: number; limit: number; search: string };
export type CustomerListResult = {
  rows: CustomerListItem[];
  total: number;
  page: number;
  totalPages: number;
};

export type CustomerSummary = {
  registered: number;
  onboarded: number;
  pending: number;
  totalOrders: number;
};

/** Aggregates stay global, independent of the list's search/page. */
export async function getCustomerSummary(): Promise<CustomerSummary> {
  const [[customerCounts], [orderCounts]] = await Promise.all([
    db.select({
      registered: count(),
      onboarded: sql<number>`count(*) filter (where ${clients.onboardingCompleted} = true)`.mapWith(Number),
    }).from(clients),
    db.select({ totalOrders: count() }).from(orders)
      .innerJoin(clients, eq(orders.userId, clients.id)),
  ]);
  const registered = customerCounts?.registered ?? 0;
  const onboarded = customerCounts?.onboarded ?? 0;
  return { registered, onboarded, pending: registered - onboarded, totalOrders: orderCounts?.totalOrders ?? 0 };
}

/** Global customer directory; callers authorize customers:view before reading. */
export async function listCustomers(input: CustomerListQuery): Promise<CustomerListResult> {
  const search = input.search.trim();
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const predicate = search ? or(
    ilike(clients.name, pattern),
    ilike(clients.email, pattern),
    ilike(clients.phone, pattern),
  ) : undefined;
  const [countRow] = await db.select({ total: count() }).from(clients).where(predicate);
  const total = countRow?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / input.limit));
  const page = Math.min(input.page, totalPages);
  const rows = await db.select({
    id: clients.id,
    name: clients.name,
    email: clients.email,
    phone: clients.phone,
    birthDate: clients.birthDate,
    gender: clients.gender,
    onboardingCompleted: clients.onboardingCompleted,
    createdAt: clients.createdAt,
    updatedAt: clients.updatedAt,
    orderCount: count(orders.id),
  })
    .from(clients)
    .leftJoin(orders, eq(orders.userId, clients.id))
    .where(predicate)
    .groupBy(clients.id)
    .orderBy(desc(clients.createdAt), desc(clients.id))
    .limit(input.limit)
    .offset((page - 1) * input.limit);

  return {
    rows: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    total, page, totalPages,
  };
}
