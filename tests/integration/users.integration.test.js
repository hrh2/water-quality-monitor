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

async function makeUser(role, isActive = true) {
  const { query } = await import('../../api/_lib/db.js');
  const { hashPassword, issueToken } = await import('../../api/_lib/auth.js');
  const email = `test-${role}-${crypto.randomUUID()}@example.com`;
  const { rows } = await query(
    'INSERT INTO users (email, password_hash, role, is_active) VALUES ($1, $2, $3, $4) RETURNING id, email, role',
    [email, await hashPassword('SomePassword123'), role, isActive]
  );
  return { ...rows[0], token: issueToken(rows[0]) };
}

test('admin can list users and activate/deactivate a regular user', { skip: !hasDb && 'DATABASE_URL/JWT_SECRET not set - skipping integration test' }, async () => {
  const { query } = await import('../../api/_lib/db.js');
  const usersHandler = (await import('../../api/users/index.js')).default;

  const admin = await makeUser('admin');
  const regularUser = await makeUser('user');

  try {
    const listRes = makeRes();
    await usersHandler(makeReq({ method: 'GET', headers: authHeader(admin.token) }), listRes);
    assert.equal(listRes.statusCode, 200);
    assert.ok(listRes.body.users.some((u) => u.email === regularUser.email));

    const deactivateRes = makeRes();
    await usersHandler(
      makeReq({ method: 'PATCH', headers: authHeader(admin.token), body: { id: regularUser.id, action: 'deactivate' } }),
      deactivateRes
    );
    assert.equal(deactivateRes.statusCode, 200);
    assert.equal(deactivateRes.body.is_active, false);

    const { rows } = await query('SELECT is_active FROM users WHERE id = $1', [regularUser.id]);
    assert.equal(rows[0].is_active, false);

    const activateRes = makeRes();
    await usersHandler(
      makeReq({ method: 'PATCH', headers: authHeader(admin.token), body: { id: regularUser.id, action: 'activate' } }),
      activateRes
    );
    assert.equal(activateRes.statusCode, 200);
    assert.equal(activateRes.body.is_active, true);
  } finally {
    await query('DELETE FROM users WHERE id IN ($1, $2)', [admin.id, regularUser.id]);
  }
});

test('a regular user cannot access user management', { skip: !hasDb && 'DATABASE_URL/JWT_SECRET not set - skipping integration test' }, async () => {
  const { query } = await import('../../api/_lib/db.js');
  const usersHandler = (await import('../../api/users/index.js')).default;

  const regularUser = await makeUser('user');
  try {
    const res = makeRes();
    await usersHandler(makeReq({ method: 'GET', headers: authHeader(regularUser.token) }), res);
    assert.equal(res.statusCode, 403);
  } finally {
    await query('DELETE FROM users WHERE id = $1', [regularUser.id]);
  }
});

test('an admin cannot deactivate their own account', { skip: !hasDb && 'DATABASE_URL/JWT_SECRET not set - skipping integration test' }, async () => {
  const { query } = await import('../../api/_lib/db.js');
  const usersHandler = (await import('../../api/users/index.js')).default;

  const admin = await makeUser('admin');
  try {
    const res = makeRes();
    await usersHandler(
      makeReq({ method: 'PATCH', headers: authHeader(admin.token), body: { id: admin.id, action: 'deactivate' } }),
      res
    );
    assert.equal(res.statusCode, 400);
  } finally {
    await query('DELETE FROM users WHERE id = $1', [admin.id]);
  }
});

test('one admin can deactivate a different admin account (only self-deactivation is blocked)', { skip: !hasDb && 'DATABASE_URL/JWT_SECRET not set - skipping integration test' }, async () => {
  const { query } = await import('../../api/_lib/db.js');
  const usersHandler = (await import('../../api/users/index.js')).default;

  const admin1 = await makeUser('admin');
  const admin2 = await makeUser('admin');

  try {
    const res = makeRes();
    await usersHandler(
      makeReq({ method: 'PATCH', headers: authHeader(admin1.token), body: { id: admin2.id, action: 'deactivate' } }),
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.is_active, false);
  } finally {
    await query('DELETE FROM users WHERE id IN ($1, $2)', [admin1.id, admin2.id]);
  }
});
