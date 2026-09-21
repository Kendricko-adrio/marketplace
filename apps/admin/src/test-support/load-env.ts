import dotenv from "dotenv";
import path from "node:path";

// =========================================================
// Test environment loader
// =========================================================
// DB-backed unit tests must have DATABASE_URL available BEFORE any module
// that imports `@/db` is evaluated (ESM evaluates imports in order of
// appearance, before the importing module's body runs). The shared
// `@/db` pool reads `process.env.DATABASE_URL` at module-evaluation time,
// so loading dotenv inside a test body is too late.
//
// Import this module as the FIRST import of a DB-backed test file.
dotenv.config({
  path: path.resolve(import.meta.dirname, "../../../../.env"),
});