import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // More specific subpath first — @rollup/plugin-alias matches the first
      // entry whose key is a prefix of the specifier.
      "@marketplace/db/src": path.resolve(
        import.meta.dirname,
        "../../packages/db/src"
      ),
      "@marketplace/db": path.resolve(import.meta.dirname, "../../packages/db/src"),
      "@marketplace/ui": path.resolve(import.meta.dirname, "../../packages/ui/src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // DB integration files share a development database. A sweep test scans
    // outstanding operations globally, while another test deliberately inserts
    // an unaccountable fixture; parallel files can make that sweep fail for
    // unrelated rows. Keep store test files serial, without weakening the
    // production recovery's fail-closed behavior.
    fileParallelism: false,
    passWithNoTests: true,
  },
});
