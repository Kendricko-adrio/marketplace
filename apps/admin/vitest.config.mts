import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@marketplace/db": path.resolve(import.meta.dirname, "../../packages/db/src"),
      "@marketplace/ui": path.resolve(import.meta.dirname, "../../packages/ui/src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    passWithNoTests: true,
  },
});
