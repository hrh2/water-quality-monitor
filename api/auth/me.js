import { query } from '../_lib/db.js';
import { sendJson, methodNotAllowed, withErrorHandling, requireAdmin } from '../_lib/http.js';

// GET /api/auth/me - returns the authenticated admin's own profile.
export default withErrorHandling(async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const auth = requireAdmin(req, res);
  if (!auth) return;

  const { rows } = await query(
    'SELECT id, email, must_change_password, created_at, last_login_at FROM admins WHERE id = $1',
    [auth.sub]
  );
  if (rows.length === 0) return sendJson(res, 401, { error: 'Admin account no longer exists' });

  return sendJson(res, 200, rows[0]);
});
