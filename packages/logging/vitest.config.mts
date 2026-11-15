import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "logging",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
