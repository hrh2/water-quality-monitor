import { query } from '../_lib/db.js';
import { hashPassword, verifyPassword } from '../_lib/auth.js';
import { sendJson, methodNotAllowed, withErrorHandling, requireAdmin, readJsonBody } from '../_lib/http.js';

// POST /api/auth/change-password
// Body: { current_password, new_password }
// Used both for the forced first-login change (must_change_password) and
// voluntary password changes.
export default withErrorHandling(async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const auth = requireAdmin(req, res);
  if (!auth) return;

  const { current_password, new_password } = await readJsonBody(req);
  if (typeof current_password !== 'string' || typeof new_password !== 'string') {
    return sendJson(res, 400, { error: 'current_password and new_password are required' });
  }
  if (new_password.length < 10) {
    return sendJson(res, 400, { error: 'new_password must be at least 10 characters' });
  }

  const { rows } = await query('SELECT * FROM admins WHERE id = $1', [auth.sub]);
  const admin = rows[0];
  if (!admin || !(await verifyPassword(current_password, admin.password_hash))) {
    return sendJson(res, 401, { error: 'current_password is incorrect' });
  }

  const newHash = await hashPassword(new_password);
  await query(
    'UPDATE admins SET password_hash = $1, must_change_password = false WHERE id = $2',
    [newHash, admin.id]
  );

  return sendJson(res, 200, { ok: true });
});
