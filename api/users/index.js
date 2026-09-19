import { query } from '../_lib/db.js';
import { sendJson, methodNotAllowed, withErrorHandling, requireAdmin, readJsonBody } from '../_lib/http.js';

// GET   /api/users                              - list all users (admin-only)
// PATCH /api/users  { id, action }              - action: 'activate' | 'deactivate' (admin-only)
export default withErrorHandling(async function handler(req, res) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  if (req.method === 'GET') {
    const { rows } = await query(
      `SELECT id, email, role, is_active, must_change_password, created_at, last_login_at
       FROM users ORDER BY created_at DESC`
    );
    return sendJson(res, 200, { users: rows });
  }

  if (req.method === 'PATCH') {
    const { id, action } = await readJsonBody(req);
    if (!id || !['activate', 'deactivate'].includes(action)) {
      return sendJson(res, 400, { error: "id and action ('activate'|'deactivate') are required" });
    }

    const { rows: targetRows } = await query('SELECT id, role, is_active FROM users WHERE id = $1', [id]);
    const target = targetRows[0];
    if (!target) return sendJson(res, 404, { error: 'User not found' });

    // Blocking self-deactivation is sufficient, on its own, to make a
    // total-admin-lockout unreachable through this endpoint: the caller
    // must already be an active admin (requireAdmin above) and is
    // guaranteed to remain active after this call (since they can't be
    // the target), so at least one active admin always remains. A
    // separate "don't deactivate the last active admin" count check was
    // considered and dropped - it can never actually trigger given the
    // above, so it would be untestable dead code.
    if (action === 'deactivate' && target.id === auth.id) {
      return sendJson(res, 400, { error: 'You cannot deactivate your own account' });
    }

    const { rows } = await query(
      'UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, email, role, is_active',
      [action === 'activate', id]
    );

    await query(
      'INSERT INTO system_events (event_type, message, metadata) VALUES ($1, $2, $3)',
      [
        action === 'activate' ? 'user_activated' : 'user_deactivated',
        `User ${rows[0].email} ${action}d by ${auth.email}`,
        JSON.stringify({ user_id: id, by: auth.id }),
      ]
    );

    return sendJson(res, 200, rows[0]);
  }

  return methodNotAllowed(res, ['GET', 'PATCH']);
});
