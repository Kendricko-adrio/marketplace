import { defineConfig } from "vitest/config";

/**
 * Project vitest untuk tooling repo-level di `scripts/` (bukan app/package).
 *
 * `vitest.config.mts` di root sudah mereferensikan file ini sejak sebelum plan
 * `dev-log-capture`; file-nya hilang sehingga `vitest run` gagal dengan
 * `Collect Error: Projects definition references a non-existing file`.
 * Project ini sengaja tanpa alias aplikasi maupun environment DB karena hanya
 * memeriksa konfigurasi repo (mis. script npm dan `.gitignore`).
 */
export default defineConfig({
  test: {
    name: "tooling",
    environment: "node",
    include: ["*.test.mts"],
  },
});
