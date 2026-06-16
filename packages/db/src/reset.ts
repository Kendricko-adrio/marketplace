import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
});

const db = drizzle(pool);

async function resetDatabase() {
  console.log("Resetting database...");

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

  console.log("All tables dropped successfully.");
  await pool.end();
}

resetDatabase().catch((error) => {
  console.error("Failed to reset database:", error);
  process.exit(1);
});
