// Integration test for the full pipeline: device registration -> reading
// ingestion -> ML prediction -> contamination assessment -> alert.
//
// Requires a real Postgres reachable via DATABASE_URL with the schema from
// db/migrations already applied (see tests/README.md for a from-scratch
// local setup). Skips itself (not a failure) if DATABASE_URL is unset, so
// `npm test` still runs the pure unit suites without a database.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

const hasDb = Boolean(process.env.DATABASE_URL) && Boolean(process.env.JWT_SECRET);

// Without this, the open Postgres pool keeps the event loop alive and
// `node --test` never exits after the integration suite runs.
after(async () => {
  if (!hasDb) return;
  const { getPool } = await import('../../api/_lib/db.js');
  await getPool().end();
});

test('device registration -> reading ingestion -> prediction -> alert', { skip: !hasDb && 'DATABASE_URL/JWT_SECRET not set - skipping integration test' }, async () => {
  const { hashPassword } = await import('../../api/_lib/auth.js');
  const { query } = await import('../../api/_lib/db.js');
  const { ingestReading } = await import('../../api/_lib/ingest.js');

  const deviceId = `test-device-${crypto.randomUUID()}`;
  const plaintextToken = 'integration-test-token';
  const tokenHash = await hashPassword(plaintextToken);

  await query(
    'INSERT INTO devices (device_id, device_token_hash) VALUES ($1, $2)',
    [deviceId, tokenHash]
  );

  try {
    const safe = await ingestReading({
      device_id: deviceId, token: plaintextToken, ts: 1,
      ph: 7.2, turbidity_ntu: 2.0, tds_ppm: 200,
    });
    assert.equal(safe.water_quality_category, 'Safe');
    assert.equal(safe.contamination_risk, false);
    assert.equal(safe.alert, null);

    const critical = await ingestReading({
      device_id: deviceId, token: plaintextToken, ts: 2,
      ph: 3.8, turbidity_ntu: 150, tds_ppm: 4000,
    });
    assert.equal(critical.water_quality_category, 'Critical');
    assert.equal(critical.contamination_risk, true);
    assert.ok(critical.alert, 'expected an alert to be created for a Critical reading');
    assert.equal(critical.alert.severity, 'critical');

    const { rows: deviceRows } = await query('SELECT last_seen_at FROM devices WHERE device_id = $1', [deviceId]);
    assert.ok(deviceRows[0].last_seen_at, 'last_seen_at should be updated after ingestion');
  } finally {
    await query('DELETE FROM devices WHERE device_id = $1', [deviceId]);
  }
});

test('wrong device token is rejected with 401-equivalent IngestError', { skip: !hasDb && 'DATABASE_URL/JWT_SECRET not set - skipping integration test' }, async () => {
  const { hashPassword } = await import('../../api/_lib/auth.js');
  const { query } = await import('../../api/_lib/db.js');
  const { ingestReading, IngestError } = await import('../../api/_lib/ingest.js');

  const deviceId = `test-device-${crypto.randomUUID()}`;
  await query('INSERT INTO devices (device_id, device_token_hash) VALUES ($1, $2)', [
    deviceId,
    await hashPassword('correct-token'),
  ]);

  try {
    await assert.rejects(
      () => ingestReading({ device_id: deviceId, token: 'wrong-token', turbidity_ntu: 1, tds_ppm: 1 }),
      (err) => err instanceof IngestError && err.statusCode === 401
    );
  } finally {
    await query('DELETE FROM devices WHERE device_id = $1', [deviceId]);
  }
});
