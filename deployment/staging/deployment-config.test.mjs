import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const directory = path.dirname(fileURLToPath(import.meta.url));

function render() {
  const temporary = mkdtempSync(path.join(tmpdir(), "staging-compose-test-"));
  const fixture = {
    DATABASE_URL: "postgresql://fixture:fixture@host.docker.internal:5432/qadfstore",
    BETTER_AUTH_SECRET: "fixture-auth-never-a-real-secret",
    GOOGLE_CLIENT_ID: "fixture-google", GOOGLE_CLIENT_SECRET: "fixture-google-secret",
    SMTP_USER: "fixture@example.invalid", SMTP_PASS: "fixture-smtp", SMTP_FROM: "fixture@example.invalid",
    MIDTRANS_SERVER_KEY: "SB-Mid-server-fixture", MIDTRANS_CLIENT_KEY: "SB-Mid-client-fixture",
    // Staging must not inherit these dangerous overrides.
    MIDTRANS_IS_PRODUCTION: "true", JUBELIO_STOCK_WRITES_ENABLED: "true",
    E2E_PROVIDER_MOCKS: "true", JUBELIO_SALES_MOCK_API_BASE_URL: "http://127.0.0.1:9999",
    CRON_SECRET: "fixture-cron", JUBELIO_EMAIL: "sandbox@example.invalid", JUBELIO_PASSWORD: "fixture-jubelio",
    JUBELIO_CHANNEL_ID: "64", JUBELIO_WEBHOOK_SECRET: "fixture-webhook",
    JUBELIO_SHIPMENT_CLIENT_ID: "fixture-shipment", JUBELIO_SHIPMENT_CLIENT_SECRET: "fixture-shipment-secret",
    JUBELIO_SHIPMENT_WEBHOOK_SECRET: "fixture-shipment-webhook", JUBELIO_PAYMENT_ACCOUNT_ID: "2",
    JUBELIO_PAYMENT_TYPE: "0", JUBELIO_ITEM_UNIT: "Buah", JUBELIO_ITEM_TAX_ID: "1",
    JUBELIO_SYNC_MAX_PRODUCTS: "3", JUBELIO_SYNC_START_PAGE: "4",
    APP_RELEASE: "fixture-release", BOOTSTRAP_REPORT_DIR: path.join(temporary, "reports"),
  };
  const file = path.join(temporary, "fixture.env");
  writeFileSync(file, Object.entries(fixture).map(([key, value]) => `${key}=${value}`).join("\n"));
  try {
    // Do not load the developer env or inherit provider credentials from the shell.
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      /^(PATH|Path|PATHEXT|SYSTEMROOT|SystemRoot|WINDIR|HOME|USERPROFILE|TEMP|TMP|DOCKER_CONFIG|DOCKER_HOST|APPDATA|LOCALAPPDATA|PROGRAMDATA|ProgramData|ProgramFiles|ProgramFiles\(x86\))$/i.test(key)));
    const result = spawnSync("docker", ["compose", "-p", "staging-config-test", "-f",
      path.join(directory, "docker-compose.yml"), "--env-file", file, "--profile", "tools", "config", "--format", "json"],
    { env: environment, encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 0, `dummy Compose configuration must render successfully: ${result.stderr}`);
    return { services: JSON.parse(result.stdout).services, fixture };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

test("resolved staging uses one sandbox release/DB, secure app realms and reference-only tools", () => {
  const { services, fixture } = render();
  for (const name of ["store", "admin", "migrate", "bootstrap"]) {
    const service = services[name];
    assert.ok(service, `${name} exists`);
    assert.equal(service.environment.APP_ENV, "staging", `${name}: staging runtime`);
    assert.equal(service.environment.NODE_ENV, "production", `${name}: Node production runtime`);
    assert.equal(service.environment.DATABASE_URL, fixture.DATABASE_URL);
    assert.equal(service.environment.APP_RELEASE, fixture.APP_RELEASE);
    assert.equal(service.environment.E2E_PROVIDER_MOCKS, undefined);
    assert.equal(service.environment.JUBELIO_SALES_MOCK_API_BASE_URL, undefined);
    for (const value of Object.values(service.build.args ?? {})) {
      assert.ok(!String(value).includes("fixture-auth") && !String(value).includes("fixture-jubelio"));
    }
  }
  for (const name of ["store", "admin"]) {
    assert.equal(services[name].environment.BETTER_AUTH_SECRET, fixture.BETTER_AUTH_SECRET);
    assert.equal(services[name].environment.BETTER_AUTH_URL, `https://dev-${name}.adfsport.cloud`);
    assert.equal(services[name].environment.STORE_INTERNAL_URL, "http://store:3000");
    assert.equal(services[name].ports, undefined);
    assert.equal(services[name].environment.JUBELIO_SHIPMENT_CLIENT_ID, fixture.JUBELIO_SHIPMENT_CLIENT_ID);
    assert.equal(services[name].environment.JUBELIO_SYNC_MAX_PRODUCTS, "");
    assert.equal(services[name].environment.JUBELIO_SYNC_START_PAGE, "");
  }
  const store = services.store.environment;
  assert.equal(store.JUBELIO_SALES_TEST_ACCOUNT_ENABLED, "true");
  assert.equal(store.JUBELIO_STOCK_WRITES_ENABLED, "false");
  assert.equal(store.MIDTRANS_IS_PRODUCTION, "false");
  assert.equal(store.CHECKOUT_TRUST_PROXY, "true");
  assert.equal(store.JUBELIO_PAYMENT_ACCOUNT_ID, "2");
  assert.equal(store.JUBELIO_PAYMENT_TYPE, "0");
  assert.equal(store.JUBELIO_SHIPMENT_WEBHOOK_SECRET, fixture.JUBELIO_SHIPMENT_WEBHOOK_SECRET);
  const bootstrap = services.bootstrap;
  assert.deepEqual(bootstrap.entrypoint, ["npx", "tsx", "src/production-bootstrap.ts"]);
  assert.deepEqual(bootstrap.profiles, ["tools"]);
  assert.equal(bootstrap.environment.JUBELIO_SYNC_MAX_PRODUCTS, "");
  assert.equal(bootstrap.environment.JUBELIO_SYNC_START_PAGE, "");
  for (const secret of ["MIDTRANS_SERVER_KEY", "SMTP_PASS", "JUBELIO_SHIPMENT_CLIENT_SECRET", "CRON_SECRET"]) {
    assert.equal(bootstrap.environment[secret], undefined, `tools do not receive ${secret}`);
  }
  const manifest = bootstrap.volumes.find(volume => volume.target === "/bootstrap/bootstrap.config.json");
  assert.equal(manifest?.type, "bind");
  assert.equal(manifest?.read_only, true);
  assert.equal(manifest?.bind?.create_host_path, false);
  assert.ok(bootstrap.volumes.some(volume => volume.target === "/reports"));
});

test("Docker build context excludes nested env, actual manifests and secret directories", () => {
  const temporary = mkdtempSync(path.join(tmpdir(), "staging-context-test-"));
  const context = path.join(temporary, "context");
  const output = path.join(temporary, "output");
  mkdirSync(context);
  const forbidden = [".env", "apps/store/.env.local", "apps/admin/.env.local",
    "deployment/staging/.env", "deployment/staging/.env.staging",
    "deployment/staging/bootstrap.config.json", "deployment/production/bootstrap.config.private.json",
    "deployment/staging/secrets/owner.password", "deployment/production/secrets/owner.password",
    ".scratch/private.md", "playwright/mcp/private.json"];
  const permitted = ["deployment/staging/.env.example", "deployment/staging/bootstrap.config.example.json",
    "packages/db/package.json", "apps/store/src/app/page.tsx"];
  try {
    copyFileSync(path.resolve(directory, "../../.dockerignore"), path.join(context, ".dockerignore"));
    for (const file of [...forbidden, ...permitted]) {
      mkdirSync(path.dirname(path.join(context, file)), { recursive: true });
      writeFileSync(path.join(context, file), "dummy-fixture-only");
    }
    writeFileSync(path.join(context, "Dockerfile"), "FROM scratch\nCOPY . /\n");
    const result = spawnSync("docker", ["build", "--quiet", "--output", `type=local,dest=${output}`, context],
      { encoding: "utf8", timeout: 90_000 });
    assert.equal(result.status, 0, "dummy build context can be exported");
    for (const file of forbidden) assert.equal(existsSync(path.join(output, file)), false, `excluded: ${file}`);
    for (const file of permitted) assert.equal(existsSync(path.join(output, file)), true, `retained: ${file}`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
