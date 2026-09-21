import type { AnyPgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export const seedCleanupEntries: ReadonlyArray<
  readonly [name: string, table: AnyPgTable]
> = [
  ["notifications", schema.notifications],
  // New RBAC tables: grants before roles; roles after users because
  // users.role_id references admin_role with ON DELETE RESTRICT.
  // (The legacy permission table was dropped by migration 0018.)
  ["adminRoleGrants", schema.adminRoleGrants],
  ["staticPages", schema.staticPages],
  ["footerConfig", schema.footerConfig],
  ["homepageSectionProducts", schema.homepageSectionProducts],
  ["homepageSections", schema.homepageSections],
  ["cartItems", schema.cartItems],
  ["carts", schema.carts],
  ["jubelioStockOperations", schema.jubelioStockOperations],
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
  ["adminRoles", schema.adminRoles],
  ["branches", schema.branches],
  ["vouchers", schema.vouchers],
  ["addresses", schema.addresses],
  ["clientSessions", schema.clientSessions],
  ["clientAccounts", schema.clientAccounts],
  ["clientVerifications", schema.clientVerifications],
  ["clients", schema.clients],
];
