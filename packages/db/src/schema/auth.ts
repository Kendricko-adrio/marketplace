import { pgTable, text, timestamp, boolean, date } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// =========================================================
// STORE: Client (customer) authentication schema
// Better Auth "user" mapping: clients
// =========================================================
export const clients = pgTable("client", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // Identity / onboarding fields (filled post-signup or post-Google callback)
  phone: text("phone"),
  birthDate: date("birth_date"),
  gender: text("gender"), // male | female | other
  onboardingCompleted: boolean("onboarding_completed")
    .notNull()
    .default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const clientSessions = pgTable("client_session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const clientAccounts = pgTable("client_account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const clientVerifications = pgTable("client_verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Relations for clients
export const clientsRelations = relations(clients, ({ many }) => ({
  sessions: many(clientSessions),
  accounts: many(clientAccounts),
}));

export const clientSessionsRelations = relations(clientSessions, ({ one }) => ({
  user: one(clients, {
    fields: [clientSessions.userId],
    references: [clients.id],
  }),
}));

export const clientAccountsRelations = relations(clientAccounts, ({ one }) => ({
  user: one(clients, {
    fields: [clientAccounts.userId],
    references: [clients.id],
  }),
}));

// =========================================================
// ADMIN: Staff / HQ authentication schema
// Better Auth "user" mapping: users
// =========================================================
export const users = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  username: text("username").unique(),
  displayUsername: text("display_username"),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: text("role").notNull().default("admin"), // admin | hq
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const adminSessions = pgTable("admin_session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const adminAccounts = pgTable("admin_account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const adminVerifications = pgTable("admin_verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Relations for admin users
export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(adminSessions),
  accounts: many(adminAccounts),
}));

export const adminSessionsRelations = relations(adminSessions, ({ one }) => ({
  user: one(users, {
    fields: [adminSessions.userId],
    references: [users.id],
  }),
}));

export const adminAccountsRelations = relations(adminAccounts, ({ one }) => ({
  user: one(users, {
    fields: [adminAccounts.userId],
    references: [users.id],
  }),
}));
