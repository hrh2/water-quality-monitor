// Covers api/dashboard.js's role branch and, critically, that a regular
// user's dashboard is scoped to ONLY their own activity - never another
// user's predictions or reports. Also covers that POST /api/predict now
// logs to prediction_requests (see api/predict.js's comment on why this
// is a separate table from `predictions`).
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
    "INSERT INTO users (email, password_hash, role, first_name, last_name) VALUES ($1, $2, $3, 'Test', 'User') RETURNING id, email, role, first_name, last_name",
    [email, await hashPassword('SomePassword123'), role]
  );
  return { ...rows[0], token: issueToken(rows[0]) };
}

test('a prediction request is logged and shows up in the caller\'s own dashboard, not another user\'s', { skip: !hasDb && 'DATABASE_URL/JWT_SECRET not set - skipping integration test' }, async () => {
  const { query } = await import('../../api/_lib/db.js');
  const predictHandler = (await import('../../api/predict.js')).default;
  const dashboardHandler = (await import('../../api/dashboard.js')).default;

  const userA = await makeUser('user');
  const userB = await makeUser('user');

  try {
    const predictRes = makeRes();
    await predictHandler(
      makeReq({ method: 'POST', headers: authHeader(userA.token), body: { ph: 7.1, turbidity_ntu: 2, tds_ppm: 200 } }),
      predictRes
    );
    assert.equal(predictRes.statusCode, 200);

    const { rows } = await query('SELECT * FROM prediction_requests WHERE user_id = $1', [userA.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].water_quality_category, predictRes.body.water_quality_category);

    const dashA = makeRes();
    await dashboardHandler(makeReq({ method: 'GET', headers: authHeader(userA.token) }), dashA);
    assert.equal(dashA.statusCode, 200);
    assert.equal(dashA.body.predictions.total, 1);
    assert.equal(dashA.body.first_name, 'Test');

    // userB made no predictions - their dashboard must show zero, not
    // userA's prediction leaking across accounts.
    const dashB = makeRes();
    await dashboardHandler(makeReq({ method: 'GET', headers: authHeader(userB.token) }), dashB);
    assert.equal(dashB.statusCode, 200);
    assert.equal(dashB.body.predictions.total, 0);
    assert.deepEqual(dashB.body.predictions.recent, []);
  } finally {
    await query('DELETE FROM prediction_requests WHERE user_id IN ($1, $2)', [userA.id, userB.id]);
    await query('DELETE FROM users WHERE id IN ($1, $2)', [userA.id, userB.id]);
  }
});

test('an admin dashboard shows cross-platform totals, not a single user\'s data', { skip: !hasDb && 'DATABASE_URL/JWT_SECRET not set - skipping integration test' }, async () => {
  const { query } = await import('../../api/_lib/db.js');
  const dashboardHandler = (await import('../../api/dashboard.js')).default;
  const admin = await makeUser('admin');

  try {
    const res = makeRes();
    await dashboardHandler(makeReq({ method: 'GET', headers: authHeader(admin.token) }), res);
    assert.equal(res.statusCode, 200);
    assert.ok('total_users' in res.body);
    assert.ok('total_prediction_requests' in res.body);
    assert.ok('total_reports_exported' in res.body);
    assert.ok('devices' in res.body);
    assert.equal('predictions' in res.body, false); // that's the user-shape key, not the admin one
  } finally {
    await query('DELETE FROM users WHERE id = $1', [admin.id]);
  }
});
