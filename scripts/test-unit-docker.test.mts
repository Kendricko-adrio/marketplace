import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('menjalankan batch serial di database tes Docker dan meneruskan status runner', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marketplace-docker-test-'));
  try {
    const npm = join(dir, 'npm.cjs');
    writeFileSync(npm, `
      console.log(JSON.stringify({ args: process.argv.slice(2), url: process.env.DATABASE_URL }));
      process.exitCode = 7;
    `);

    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !['npm_execpath', 'database_url'].includes(key.toLowerCase()),
    ));
    const result = spawnSync(process.execPath, ['scripts/test-unit-docker.mjs'], {
      encoding: 'utf8',
      timeout: 5_000,
      env: { ...env, npm_execpath: npm, database_url: 'postgresql://localhost/storefront' },
    });

    expect(result.status, result.stderr).toBe(7);
    const launched = JSON.parse(result.stdout);
    expect(launched.args).toEqual(['run', 'verify:batch:unit']);
    expect(new URL(launched.url).host).toBe('localhost:5432');
    expect(new URL(launched.url).pathname).toBe('/marketplace_discounts_test_e2e_shared');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
