import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(path), "utf8");

describe("isolasi fixture Jubelio dari development dan deployment", () => {
  it("staging tidak mendefinisikan service, dependency, atau URL mock", () => {
    const compose = read("deployment/staging/docker-compose.yml");
    expect(compose).not.toMatch(/jubelio-mock|JUBELIO_MOCK_API_BASE_URL/);
    // Penghapusan mock tidak boleh mengubah mode maupun izin write existing.
    expect(compose).toContain("APP_ENV: production");
    expect(compose).toContain('JUBELIO_STOCK_WRITES_ENABLED: "true"');
    expect(compose).toContain("JUBELIO_EMAIL: ${JUBELIO_EMAIL}");
  });

  it("image aplikasi dan migrasi tidak membutuhkan workspace mock", () => {
    for (const app of ["store", "admin", "migrate"]) {
      expect(read(`deployment/common/${app}/Dockerfile`)).not.toContain("jubelio-mock");
    }
    expect(existsSync(resolve("deployment/common/jubelio-mock"))).toBe(false);
  });

  it("kedua workspace lama dan command simulator tidak tersedia lagi", () => {
    for (const app of ["jubelio-mock", "jubelio-webhook-simulator"]) {
      expect(existsSync(resolve(`apps/${app}`))).toBe(false);
    }
    const { scripts } = JSON.parse(read("package.json"));
    expect(scripts["dev:jubelio-mock"]).toBeUndefined();
    expect(scripts["jubelio:webhook"]).toBeUndefined();
    expect(read("package-lock.json")).not.toMatch(/apps\/jubelio-(?:mock|webhook-simulator)/);
  });
});
