import type { AnyPgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export const seedCleanupEntries: ReadonlyArray<
  readonly [name: string, table: AnyPgTable]
> = [
  ["notifications", schema.notifications],
  ["permissions", schema.permissions],
  ["staticPages", schema.staticPages],
  ["footerConfig", schema.footerConfig],
  ["homepageSectionProducts", schema.homepageSectionProducts],
  ["homepageSections", schema.homepageSections],
  ["cartItems", schema.cartItems],
  ["carts", schema.carts],
  ["orderItems", schema.orderItems],
  ["orders", schema.orders],
  ["auditLogs", schema.auditLogs],
  ["systemConfig", schema.systemConfig],
  ["branchStocks", schema.branchStocks],
  ["productImages", schema.productImages],
  ["productVariants", schema.productVariants],
  ["productToCategory", schema.productToCategory],
  ["products", schema.products],
  ["brands", schema.brands],
  ["genders", schema.genders],
  ["categories", schema.categories],
  ["adminSessions", schema.adminSessions],
  ["adminAccounts", schema.adminAccounts],
  ["adminVerifications", schema.adminVerifications],
  ["users", schema.users],
  ["branches", schema.branches],
  ["vouchers", schema.vouchers],
  ["addresses", schema.addresses],
  ["clientSessions", schema.clientSessions],
  ["clientAccounts", schema.clientAccounts],
  ["clientVerifications", schema.clientVerifications],
  ["clients", schema.clients],
];
