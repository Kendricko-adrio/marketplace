/**
 * Service operasi `sweepOrderCommunications` — satu operasi sweep: proyeksi
 * fakta committed lalu dispatch email yang due, dengan budget/batch terbatas.
 *
 * Dipisah dari sweep reservasi supaya komunikasi tidak menghabiskan budget
 * recovery pembayaran/stok. Endpoint cron memanggil service ini saja; tidak ada
 * query di route.
 */

import { db } from "@/db";
import type { OrderCommunicationDb } from "@marketplace/db/src/order-communications/order-communication-repository";
import type {
  OrderCommunicationSweepSummary,
} from "@marketplace/db/src/order-communications/order-communication-contract";
import { createModuleLogger } from "@/lib/logger";
import { projectOrderCommunications } from "./project-order-communications-service";
import { sendDueOrderEmails } from "./send-order-emails-service";
import type { OrderEmailSender } from "./order-email-client";

const log = createModuleLogger("order-communications");

export async function sweepOrderCommunications(input: {
  limit: number;
  deadline: Date;
  now?: Date;
  sender?: OrderEmailSender;
  database?: OrderCommunicationDb;
  mirror?: boolean;
}): Promise<OrderCommunicationSweepSummary> {
  const database = input.database ?? (db as unknown as OrderCommunicationDb);
  const now = input.now ?? new Date();

  const projected = await projectOrderCommunications({
    limit: input.limit,
    now,
    database,
    ...(input.mirror === false ? { mirror: false } : {}),
  });

  const dispatched = await sendDueOrderEmails({
    limit: input.limit,
    now,
    deadline: input.deadline,
    database,
    ...(input.sender ? { sender: input.sender } : {}),
  });

  const summary: OrderCommunicationSweepSummary = {
    ...projected,
    ...dispatched,
  };
  log.info(
    `order communications sweep completed: projected ${summary.projected}, jobs ${summary.emailJobsCreated}, notifications ${summary.notificationsCreated}, claimed ${summary.claimed}, sent ${summary.sent}, retry ${summary.retry}, failed ${summary.failed}, superseded ${summary.superseded}`
  );
  return summary;
}
