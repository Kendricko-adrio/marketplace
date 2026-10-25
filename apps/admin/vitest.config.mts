import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // More specific subpath first — @rollup/plugin-alias matches the first
      // entry whose key is a prefix of the specifier.
      "@marketplace/db/src/schema": path.resolve(
        import.meta.dirname,
        "../../packages/db/src/schema"
      ),
      "@marketplace/db/src/rbac": path.resolve(
        import.meta.dirname,
        "../../packages/db/src/rbac"
      ),
      "@marketplace/db/src": path.resolve(import.meta.dirname, "../../packages/db/src"),
      "@marketplace/db": path.resolve(import.meta.dirname, "../../packages/db/src"),
      // Resolve the logging core straight from source so unit tests never depend
      // on the package's dist artifact being built first.
      "@marketplace/logging": path.resolve(
        import.meta.dirname,
        "../../packages/logging/src/index.ts"
      ),
      "@marketplace/ui": path.resolve(import.meta.dirname, "../../packages/ui/src"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    passWithNoTests: true,
  },
});
