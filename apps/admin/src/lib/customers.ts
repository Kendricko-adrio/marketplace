import "server-only";

import { branches, clients, db, orderItems, orders } from "@/db";
import { count, desc, eq } from "drizzle-orm";

export type CustomerListItem = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  birthDate: string | null;
  gender: string | null;
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
  orderCount: number;
};

export type CustomerOrderHistoryItem = {
  id: string;
  status: string;
  paymentStatus: string;
  total: string;
  createdAt: string;
  pickupDate: string | null;
  branchName: string | null;
  itemCount: number;
};

export async function getCustomers(): Promise<CustomerListItem[]> {
  const rows = await db
    .select({
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
    .groupBy(clients.id)
    .orderBy(desc(clients.createdAt));

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function getCustomerDetail(id: string) {
  const [customer] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, id))
    .limit(1);

  if (!customer) return null;

  const orderRows = await db
    .select({
      id: orders.id,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      total: orders.total,
      createdAt: orders.createdAt,
      pickupDate: orders.pickupDate,
      branchName: branches.name,
      itemCount: count(orderItems.id),
    })
    .from(orders)
    .leftJoin(branches, eq(orders.branchId, branches.id))
    .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(eq(orders.userId, id))
    .groupBy(orders.id, branches.name)
    .orderBy(desc(orders.createdAt));

  return {
    customer: {
      ...customer,
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
    },
    orders: orderRows.map((order): CustomerOrderHistoryItem => ({
      ...order,
      createdAt: order.createdAt.toISOString(),
      pickupDate: order.pickupDate?.toISOString() ?? null,
    })),
  };
}
