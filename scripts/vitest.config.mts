import { defineConfig } from "vitest/config";

// Unit test untuk tooling repo (resolver conductor tiket).
// Dipisah dari workspace aplikasi karena tidak memakai alias @/ atau DB.
export default defineConfig({
  test: {
    name: "scripts",
    environment: "node",
    include: ["*.test.mjs"],
  },
});
