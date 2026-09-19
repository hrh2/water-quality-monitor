import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { makeReq, makeRes, authHeader } from './http-test-helpers.js';

const hasDb = Boolean(process.env.DATABASE_URL) && Boolean(process.env.JWT_SECRET);

after(async () => {
  if (!hasDb) return;
  const { getPool } = await import('../../api/_lib/db.js');
  await getPool().end();
});

async function makeUser(role) {
  const { query } = await import('../../api/_lib/db.js');
  const { hashPassword, issueToken } = await import('../../api/_lib/auth.js');
  const email = `test-${role}-${crypto.randomUUID()}@example.com`;
  const { rows } = await query(
    'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role',
    [email, await hashPassword('SomePassword123'), role]
  );
  return { ...rows[0], token: issueToken(rows[0]) };
}

// Bytes written via res.end() in the http-test-helpers mock land in
// res.body only when JSON-parsed there; reports write raw CSV/PDF via
// res.end(rawString/Buffer) directly, so capture that raw value too.
function makeRawCaptureRes() {
  const res = makeRes();
  const originalEnd = res.end.bind(res);
  res.rawBody = undefined;
  res.end = (payload) => {
    res.rawBody = payload;
    try {
      originalEnd(payload);
    } catch {
      /* payload isn't JSON (CSV/PDF) - that's expected, ignore */
    }
  };
  return res;
}

test('a regular (non-admin) user can export a CSV readings report', { skip: !hasDb && 'DATABASE_URL/JWT_SECRET not set - skipping integration test' }, async () => {
  const { query } = await import('../../api/_lib/db.js');
  const { hashPassword } = await import('../../api/_lib/auth.js');
  const { ingestReading } = await import('../../api/_lib/ingest.js');
  const reportsHandler = (await import('../../api/reports/[type].js')).default;

  const deviceId = `test-report-device-${crypto.randomUUID()}`;
  const plaintextToken = 'report-test-token';
  await query('INSERT INTO devices (device_id, device_token_hash) VALUES ($1, $2)', [deviceId, await hashPassword(plaintextToken)]);
  await ingestReading({ device_id: deviceId, token: plaintextToken, ts: 1, ph: 7.1, turbidity_ntu: 2.0, tds_ppm: 200 });

  const user = await makeUser('user');

  try {
    const res = makeRawCaptureRes();
    await reportsHandler(
      makeReq({ method: 'GET', query: { type: 'readings', format: 'csv', device_id: deviceId }, headers: authHeader(user.token) }),
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'text/csv; charset=utf-8');
    assert.ok(res.rawBody.startsWith('Device,Received At'));
    assert.ok(res.rawBody.includes(deviceId));
  } finally {
    await query('DELETE FROM devices WHERE device_id = $1', [deviceId]);
    await query('DELETE FROM users WHERE id = $1', [user.id]);
  }
});

test('a PDF report is generated with a valid PDF header', { skip: !hasDb && 'DATABASE_URL/JWT_SECRET not set - skipping integration test' }, async () => {
  const { query } = await import('../../api/_lib/db.js');
  const reportsHandler = (await import('../../api/reports/[type].js')).default;
  const admin = await makeUser('admin');

  try {
    const res = makeRawCaptureRes();
    await reportsHandler(
      makeReq({ method: 'GET', query: { type: 'devices', format: 'pdf' }, headers: authHeader(admin.token) }),
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'application/pdf');
    assert.ok(Buffer.isBuffer(res.rawBody));
    assert.equal(res.rawBody.subarray(0, 5).toString('ascii'), '%PDF-');
  } finally {
    await query('DELETE FROM users WHERE id = $1', [admin.id]);
  }
});

test('an unknown report type is rejected with 400', { skip: !hasDb && 'DATABASE_URL/JWT_SECRET not set - skipping integration test' }, async () => {
  const { query } = await import('../../api/_lib/db.js');
  const reportsHandler = (await import('../../api/reports/[type].js')).default;
  const user = await makeUser('user');

  try {
    const res = makeRes();
    await reportsHandler(
      makeReq({ method: 'GET', query: { type: 'not-a-real-report' }, headers: authHeader(user.token) }),
      res
    );
    assert.equal(res.statusCode, 400);
  } finally {
    await query('DELETE FROM users WHERE id = $1', [user.id]);
  }
});

test('report export requires authentication', { skip: !hasDb && 'DATABASE_URL/JWT_SECRET not set - skipping integration test' }, async () => {
  const reportsHandler = (await import('../../api/reports/[type].js')).default;
  const res = makeRes();
  await reportsHandler(makeReq({ method: 'GET', query: { type: 'alerts' } }), res);
  assert.equal(res.statusCode, 401);
});
