// Closes a gap flagged honestly in docs/requirements-traceability.md:
// the admin auth flow (login, /me, change-password, and rejecting bad
// credentials/tokens) previously had no automated test.
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

test('login -> /me -> change-password -> re-login with new password', { skip: !hasDb && 'DATABASE_URL/JWT_SECRET not set - skipping integration test' }, async () => {
  const { query } = await import('../../api/_lib/db.js');
  const { hashPassword } = await import('../../api/_lib/auth.js');
  const login = (await import('../../api/auth/login.js')).default;
  const me = (await import('../../api/auth/me.js')).default;
  const changePassword = (await import('../../api/auth/change-password.js')).default;

  const email = `test-admin-${crypto.randomUUID()}@example.com`;
  const initialPassword = 'InitialPassword123';
  const newPassword = 'BrandNewPassword456';
  await query(
    'INSERT INTO admins (email, password_hash, must_change_password) VALUES ($1, $2, true)',
    [email, await hashPassword(initialPassword)]
  );

  try {
    // Wrong password rejected
    const badRes = makeRes();
    await login(makeReq({ method: 'POST', body: { email, password: 'wrong' } }), badRes);
    assert.equal(badRes.statusCode, 401);

    // Correct login
    const loginRes = makeRes();
    await login(makeReq({ method: 'POST', body: { email, password: initialPassword } }), loginRes);
    assert.equal(loginRes.statusCode, 200);
    assert.equal(loginRes.body.must_change_password, true);
    const token = loginRes.body.token;
    assert.ok(token);

    // /me with the issued token
    const meRes = makeRes();
    await me(makeReq({ method: 'GET', headers: authHeader(token) }), meRes);
    assert.equal(meRes.statusCode, 200);
    assert.equal(meRes.body.email, email);

    // /me with no token
    const meNoAuthRes = makeRes();
    await me(makeReq({ method: 'GET' }), meNoAuthRes);
    assert.equal(meNoAuthRes.statusCode, 401);

    // Change password with wrong current_password
    const badChangeRes = makeRes();
    await changePassword(
      makeReq({ method: 'POST', headers: authHeader(token), body: { current_password: 'nope', new_password: newPassword } }),
      badChangeRes
    );
    assert.equal(badChangeRes.statusCode, 401);

    // Change password successfully
    const changeRes = makeRes();
    await changePassword(
      makeReq({ method: 'POST', headers: authHeader(token), body: { current_password: initialPassword, new_password: newPassword } }),
      changeRes
    );
    assert.equal(changeRes.statusCode, 200);
    assert.equal(changeRes.body.ok, true);

    // Re-login with the new password reflects must_change_password=false
    const reloginRes = makeRes();
    await login(makeReq({ method: 'POST', body: { email, password: newPassword } }), reloginRes);
    assert.equal(reloginRes.statusCode, 200);
    assert.equal(reloginRes.body.must_change_password, false);

    // Old password no longer works
    const oldPasswordRes = makeRes();
    await login(makeReq({ method: 'POST', body: { email, password: initialPassword } }), oldPasswordRes);
    assert.equal(oldPasswordRes.statusCode, 401);
  } finally {
    await query('DELETE FROM admins WHERE email = $1', [email]);
  }
});

test('short new_password is rejected before touching the database', { skip: !hasDb && 'DATABASE_URL/JWT_SECRET not set - skipping integration test' }, async () => {
  const { query } = await import('../../api/_lib/db.js');
  const { hashPassword, issueToken } = await import('../../api/_lib/auth.js');
  const changePassword = (await import('../../api/auth/change-password.js')).default;

  const email = `test-admin-${crypto.randomUUID()}@example.com`;
  const { rows } = await query(
    'INSERT INTO admins (email, password_hash) VALUES ($1, $2) RETURNING id, email',
    [email, await hashPassword('SomePassword123')]
  );
  const token = issueToken(rows[0]);

  try {
    const res = makeRes();
    await changePassword(
      makeReq({ method: 'POST', headers: authHeader(token), body: { current_password: 'SomePassword123', new_password: 'short' } }),
      res
    );
    assert.equal(res.statusCode, 400);
  } finally {
    await query('DELETE FROM admins WHERE email = $1', [email]);
  }
});
