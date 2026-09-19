// Closes a gap flagged honestly in docs/requirements-traceability.md:
// the auth flow (login, register, /me, change-password, and rejecting bad
// credentials/tokens/deactivated accounts) previously had no automated
// test. All four actions live in the single consolidated
// api/auth/[action].js (see that file's header comment for why), so each
// is invoked here via req.query.action.
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
  const authHandler = (await import('../../api/auth/[action].js')).default;

  const email = `test-admin-${crypto.randomUUID()}@example.com`;
  const initialPassword = 'InitialPassword123';
  const newPassword = 'BrandNewPassword456';
  await query(
    "INSERT INTO users (email, password_hash, role, must_change_password) VALUES ($1, $2, 'admin', true)",
    [email, await hashPassword(initialPassword)]
  );

  try {
    // Wrong password rejected
    const badRes = makeRes();
    await authHandler(makeReq({ method: 'POST', query: { action: 'login' }, body: { email, password: 'wrong' } }), badRes);
    assert.equal(badRes.statusCode, 401);

    // Correct login
    const loginRes = makeRes();
    await authHandler(makeReq({ method: 'POST', query: { action: 'login' }, body: { email, password: initialPassword } }), loginRes);
    assert.equal(loginRes.statusCode, 200);
    assert.equal(loginRes.body.must_change_password, true);
    assert.equal(loginRes.body.role, 'admin');
    const token = loginRes.body.token;
    assert.ok(token);

    // /me with the issued token
    const meRes = makeRes();
    await authHandler(makeReq({ method: 'GET', query: { action: 'me' }, headers: authHeader(token) }), meRes);
    assert.equal(meRes.statusCode, 200);
    assert.equal(meRes.body.email, email);
    assert.equal(meRes.body.role, 'admin');

    // /me with no token
    const meNoAuthRes = makeRes();
    await authHandler(makeReq({ method: 'GET', query: { action: 'me' } }), meNoAuthRes);
    assert.equal(meNoAuthRes.statusCode, 401);

    // Change password with wrong current_password
    const badChangeRes = makeRes();
    await authHandler(
      makeReq({ method: 'POST', query: { action: 'change-password' }, headers: authHeader(token), body: { current_password: 'nope', new_password: newPassword } }),
      badChangeRes
    );
    assert.equal(badChangeRes.statusCode, 401);

    // Change password successfully
    const changeRes = makeRes();
    await authHandler(
      makeReq({ method: 'POST', query: { action: 'change-password' }, headers: authHeader(token), body: { current_password: initialPassword, new_password: newPassword } }),
      changeRes
    );
    assert.equal(changeRes.statusCode, 200);
    assert.equal(changeRes.body.ok, true);

    // Re-login with the new password reflects must_change_password=false
    const reloginRes = makeRes();
    await authHandler(makeReq({ method: 'POST', query: { action: 'login' }, body: { email, password: newPassword } }), reloginRes);
    assert.equal(reloginRes.statusCode, 200);
    assert.equal(reloginRes.body.must_change_password, false);

    // Old password no longer works
    const oldPasswordRes = makeRes();
    await authHandler(makeReq({ method: 'POST', query: { action: 'login' }, body: { email, password: initialPassword } }), oldPasswordRes);
    assert.equal(oldPasswordRes.statusCode, 401);
  } finally {
    await query('DELETE FROM users WHERE email = $1', [email]);
  }
});

test('short new_password is rejected before touching the database', { skip: !hasDb && 'DATABASE_URL/JWT_SECRET not set - skipping integration test' }, async () => {
  const { query } = await import('../../api/_lib/db.js');
  const { hashPassword, issueToken } = await import('../../api/_lib/auth.js');
  const authHandler = (await import('../../api/auth/[action].js')).default;

  const email = `test-admin-${crypto.randomUUID()}@example.com`;
  const { rows } = await query(
    "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin') RETURNING id, email, role",
    [email, await hashPassword('SomePassword123')]
  );
  const token = issueToken(rows[0]);

  try {
    const res = makeRes();
    await authHandler(
      makeReq({ method: 'POST', query: { action: 'change-password' }, headers: authHeader(token), body: { current_password: 'SomePassword123', new_password: 'short' } }),
      res
    );
    assert.equal(res.statusCode, 400);
  } finally {
    await query('DELETE FROM users WHERE email = $1', [email]);
  }
});

test('self-registration creates an active role=user account and logs in immediately', { skip: !hasDb && 'DATABASE_URL/JWT_SECRET not set - skipping integration test' }, async () => {
  const { query } = await import('../../api/_lib/db.js');
  const authHandler = (await import('../../api/auth/[action].js')).default;

  const email = `test-user-${crypto.randomUUID()}@example.com`;
  const password = 'RegisterPassword123';
  const body = { email, password, first_name: 'Ada', last_name: 'Lovelace' };

  try {
    const registerRes = makeRes();
    await authHandler(makeReq({ method: 'POST', query: { action: 'register' }, body }), registerRes);
    assert.equal(registerRes.statusCode, 201);
    assert.equal(registerRes.body.role, 'user');
    assert.equal(registerRes.body.must_change_password, false);
    assert.equal(registerRes.body.first_name, 'Ada');
    assert.ok(registerRes.body.token);

    // Duplicate registration is rejected
    const dupRes = makeRes();
    await authHandler(makeReq({ method: 'POST', query: { action: 'register' }, body }), dupRes);
    assert.equal(dupRes.statusCode, 409);

    // Fresh login works with the chosen password, no forced change
    const loginRes = makeRes();
    await authHandler(makeReq({ method: 'POST', query: { action: 'login' }, body: { email, password } }), loginRes);
    assert.equal(loginRes.statusCode, 200);
    assert.equal(loginRes.body.role, 'user');
    assert.equal(loginRes.body.must_change_password, false);

    // /me reflects the name given at registration
    const meRes = makeRes();
    await authHandler(makeReq({ method: 'GET', query: { action: 'me' }, headers: authHeader(loginRes.body.token) }), meRes);
    assert.equal(meRes.body.first_name, 'Ada');
    assert.equal(meRes.body.last_name, 'Lovelace');
  } finally {
    await query('DELETE FROM users WHERE email = $1', [email]);
  }
});

test('registration without a first/last name is rejected', { skip: !hasDb && 'DATABASE_URL/JWT_SECRET not set - skipping integration test' }, async () => {
  const authHandler = (await import('../../api/auth/[action].js')).default;
  const email = `test-user-${crypto.randomUUID()}@example.com`;

  const missingFirst = makeRes();
  await authHandler(
    makeReq({ method: 'POST', query: { action: 'register' }, body: { email, password: 'SomePassword123', last_name: 'Lovelace' } }),
    missingFirst
  );
  assert.equal(missingFirst.statusCode, 400);

  const missingLast = makeRes();
  await authHandler(
    makeReq({ method: 'POST', query: { action: 'register' }, body: { email, password: 'SomePassword123', first_name: 'Ada' } }),
    missingLast
  );
  assert.equal(missingLast.statusCode, 400);
});

test('a deactivated account is rejected at login and on an already-issued token', { skip: !hasDb && 'DATABASE_URL/JWT_SECRET not set - skipping integration test' }, async () => {
  const { query } = await import('../../api/_lib/db.js');
  const { hashPassword, issueToken } = await import('../../api/_lib/auth.js');
  const authHandler = (await import('../../api/auth/[action].js')).default;

  const email = `test-user-${crypto.randomUUID()}@example.com`;
  const password = 'DeactivatedPassword123';
  const { rows } = await query(
    "INSERT INTO users (email, password_hash, role, is_active) VALUES ($1, $2, 'user', true) RETURNING id, email, role",
    [email, await hashPassword(password)]
  );
  const user = rows[0];
  const token = issueToken(user); // issued while still active

  try {
    await query('UPDATE users SET is_active = false WHERE id = $1', [user.id]);

    // Login now rejected
    const loginRes = makeRes();
    await authHandler(makeReq({ method: 'POST', query: { action: 'login' }, body: { email, password } }), loginRes);
    assert.equal(loginRes.statusCode, 401);

    // The token issued BEFORE deactivation is also rejected on its next
    // use - this is the whole point of re-checking is_active from the
    // database on every request rather than trusting the JWT alone.
    const meRes = makeRes();
    await authHandler(makeReq({ method: 'GET', query: { action: 'me' }, headers: authHeader(token) }), meRes);
    assert.equal(meRes.statusCode, 401);
  } finally {
    await query('DELETE FROM users WHERE email = $1', [email]);
  }
});
