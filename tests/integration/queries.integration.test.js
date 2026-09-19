// Closes a gap flagged honestly in docs/requirements-traceability.md:
// the historical-query read endpoints (GET /api/readings,
// GET /api/devices/:deviceId, GET /api/predictions) previously had no
// automated test.
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

test('GET /api/readings, /api/devices/:deviceId, /api/predictions reflect ingested data', { skip: !hasDb && 'DATABASE_URL/JWT_SECRET not set - skipping integration test' }, async () => {
  const { query } = await import('../../api/_lib/db.js');
  const { hashPassword, issueToken } = await import('../../api/_lib/auth.js');
  const { ingestReading } = await import('../../api/_lib/ingest.js');
  const readingsHandler = (await import('../../api/readings.js')).default;
  const deviceDetailHandler = (await import('../../api/devices/[deviceId].js')).default;
  const predictionsHandler = (await import('../../api/predictions.js')).default;

  const deviceId = `test-query-device-${crypto.randomUUID()}`;
  const plaintextToken = 'query-test-token';
  await query('INSERT INTO devices (device_id, device_token_hash) VALUES ($1, $2)', [
    deviceId,
    await hashPassword(plaintextToken),
  ]);

  const adminEmail = `test-admin-${crypto.randomUUID()}@example.com`;
  const { rows: adminRows } = await query(
    "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin') RETURNING id, email, role",
    [adminEmail, await hashPassword('AdminPassword123')]
  );
  const adminToken = issueToken(adminRows[0]);

  try {
    await ingestReading({ device_id: deviceId, token: plaintextToken, ts: 1, ph: 7.1, turbidity_ntu: 2.0, tds_ppm: 200 });
    await ingestReading({ device_id: deviceId, token: plaintextToken, ts: 2, ph: 4.0, turbidity_ntu: 120, tds_ppm: 3500 });

    // GET /api/readings?device_id=...
    const readingsRes = makeRes();
    await readingsHandler(
      makeReq({ method: 'GET', headers: authHeader(adminToken), query: { device_id: deviceId, limit: '10' } }),
      readingsRes
    );
    assert.equal(readingsRes.statusCode, 200);
    assert.equal(readingsRes.body.readings.length, 2);
    assert.ok(readingsRes.body.readings.every((r) => r.device_id === deviceId));

    // GET /api/readings requires admin auth
    const unauthReadingsRes = makeRes();
    await readingsHandler(makeReq({ method: 'GET', query: { device_id: deviceId } }), unauthReadingsRes);
    assert.equal(unauthReadingsRes.statusCode, 401);

    // GET /api/devices/:deviceId
    const deviceDetailRes = makeRes();
    await deviceDetailHandler(
      makeReq({ method: 'GET', headers: authHeader(adminToken), query: { deviceId } }),
      deviceDetailRes
    );
    assert.equal(deviceDetailRes.statusCode, 200);
    assert.equal(deviceDetailRes.body.device_id, deviceId);
    assert.equal(deviceDetailRes.body.status, 'Online');
    assert.equal(deviceDetailRes.body.readings.length, 2);

    // GET /api/devices/:deviceId for an unknown device -> 404
    const notFoundRes = makeRes();
    await deviceDetailHandler(
      makeReq({ method: 'GET', headers: authHeader(adminToken), query: { deviceId: 'does-not-exist' } }),
      notFoundRes
    );
    assert.equal(notFoundRes.statusCode, 404);

    // GET /api/predictions?device_id=...&category=Critical
    const predictionsRes = makeRes();
    await predictionsHandler(
      makeReq({ method: 'GET', headers: authHeader(adminToken), query: { device_id: deviceId, category: 'Critical' } }),
      predictionsRes
    );
    assert.equal(predictionsRes.statusCode, 200);
    assert.ok(predictionsRes.body.predictions.length >= 1);
    assert.ok(predictionsRes.body.predictions.every((p) => p.water_quality_category === 'Critical'));
  } finally {
    await query('DELETE FROM devices WHERE device_id = $1', [deviceId]);
    await query('DELETE FROM users WHERE email = $1', [adminEmail]);
  }
});
