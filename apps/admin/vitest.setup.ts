import path from "node:path";
import dotenv from "dotenv";

// Load the repo-root `.env` BEFORE any test module (and therefore before the
// app's `@/db` pool) is evaluated. DB suites need the disposable
// `DATABASE_URL` at import time; previously that only worked when the shell had
// already exported it, so they silently skipped. Unit suites ignore the value.
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });
