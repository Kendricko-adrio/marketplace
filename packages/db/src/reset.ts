import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
});

const db = drizzle(pool);

// Mask password in connection string for safe logging.
// Shows host, port, db, user — hides password.
function maskUrl(url: string): string {
  try {
    const m = url.match(/^(postgresql:\/\/)([^:]+):([^@]*)@([^:]+):(\d+)\/(.+)$/);
    if (m) return `${m[1]}${m[2]}:***@${m[4]}:${m[5]}/${m[6]}`;
    return url.replace(/:[^:@]*@/, ":***@");
  } catch {
    return "(unable to parse DATABASE_URL)";
  }
}

async function resetDatabase() {
  console.log("=== RESET DIAGNOSTIC ===");
  console.log("DATABASE_URL:", maskUrl(process.env.DATABASE_URL || "(not set)"));
  console.log("Resetting database...");

  // Show what tables exist BEFORE dropping (helps debug "already exists" errors).
  const before = await db.execute(`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
  `);
  const tablesBefore = (before.rows || []) as { tablename: string }[];
  console.log(`Tables found BEFORE reset: ${tablesBefore.length}`);
  if (tablesBefore.length > 0) {
    console.log("  →", tablesBefore.map((r) => r.tablename).join(", "));
  }

  await db.execute(`
    DO $$
    DECLARE
      r RECORD;
    BEGIN
      FOR r IN (
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
      ) LOOP
        EXECUTE 'DROP TABLE IF EXISTS public."' || r.tablename || '" CASCADE';
      END LOOP;
    END $$;
  `);

  // Verify tables are actually gone.
  const after = await db.execute(`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
  `);
  const tablesAfter = (after.rows || []) as { tablename: string }[];
  console.log(`Tables remaining AFTER reset: ${tablesAfter.length}`);
  if (tablesAfter.length > 0) {
    console.log("  ⚠️  STILL EXISTS:", tablesAfter.map((r) => r.tablename).join(", "));
  } else {
    console.log("✅ All tables dropped successfully.");
  }

  await pool.end();
}

resetDatabase().catch((error) => {
  console.error("Failed to reset database:", error);
  process.exit(1);
});
