import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';

const script = 'scripts/simulate-jubelio-shipment.sh';
const statuses = ['WAITING', 'CONFIRMED_BY_COURIER', 'ON_THE_WAY_PICK_UP', 'PICKED_UP', 'ON_DELIVERY', 'ON_HOLD', 'DELIVERED', 'RETURNED', 'CANCELED', 'SHIPMENT_ISSUE'];
const secret = 'test-only-secret';
function run(args, secretValue = secret) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [script, ...args], {
      env: { ...process.env, JUBELIO_SHIPMENT_WEBHOOK_SECRET: secretValue },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

test('preview semua status menghasilkan identitas order yang benar tanpa secret', async () => {
  for (const status of statuses) {
    const result = await run([status, '--date', '2026-11-14T00:00:00.000Z']);
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout.trim().split('\n').at(-1));
    assert.equal(payload.latest_status, status);
    assert.equal(payload.event, 'awb');
    assert.equal(payload.ref_no, '170a6986-eaa9-49de-ab01-839775958c75');
    assert.equal(payload.shipment_id, 7);
    assert.equal(payload.awb, 'MOCK-JS2420810000000005');
    assert.equal(payload.tracking.date, '2026-11-14T00:00:00.000Z');
    assert.ok(!result.stdout.includes(secret));
  }
});

test('send mengirim raw body bertanda tangan; HTTP error menghasilkan exit nonzero', async () => {
  const receipts = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    receipts.push({ raw, signature: req.headers['x-jubelio-signature'], path: req.url });
    res.writeHead(receipts.length === 1 ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(receipts.length === 1 ? { success: true, status: 'applied' } : { success: false }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const args = ['ON_DELIVERY', '--send', '--url', `http://127.0.0.1:${server.address().port}`];
    const preview = await run(['ON_DELIVERY', '--url', `http://127.0.0.1:${server.address().port}`]);
    assert.equal(preview.code, 0, preview.stderr);
    assert.equal(receipts.length, 0, 'preview tidak boleh mengirim request');
    const success = await run(args);
    assert.equal(success.code, 0, success.stderr);
    assert.equal(receipts[0].path, '/api/webhooks/jubelio-shipment');
    assert.equal(receipts[0].signature, createHmac('sha256', secret).update(receipts[0].raw + secret).digest('hex'));
    assert.equal(JSON.parse(receipts[0].raw).latest_status, 'ON_DELIVERY');
    assert.ok(!success.stdout.includes(secret));
    assert.notEqual((await run(args)).code, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('input invalid dan secret kosong ditolak sebelum mengirim', async () => {
  for (const args of [['UNKNOWN'], ['DELIVERED', '--date', 'invalid'], ['WAITING', '--bad-option'], ['WAITING', '--url'], ['WAITING', '--url', 'https://example.com']]) {
    assert.notEqual((await run(args)).code, 0);
  }
  const missing = await run(['DELIVERED', '--send', '--env-file', 'missing-test-env-file'], '');
  assert.notEqual(missing.code, 0);
});
