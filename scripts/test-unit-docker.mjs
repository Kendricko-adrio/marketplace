import { spawnSync } from 'node:child_process';

const npm = process.env.npm_execpath;
if (!npm) {
  console.error('Jalankan perintah ini melalui npm run test:unit:docker.');
  process.exit(1);
}

// Windows treats environment keys case-insensitively.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  key.toUpperCase() !== 'DATABASE_URL',
));

// Pakai default docker-compose.yml, bukan DATABASE_URL development.
const result = spawnSync(process.execPath, [npm, 'run', 'verify:batch:unit'], {
  stdio: 'inherit',
  env: {
    ...env,
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/marketplace_discounts_test_e2e_shared',
  },
});

if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
