import { query } from '../_lib/db.js';
import { verifyPassword, issueToken } from '../_lib/auth.js';
import { sendJson, methodNotAllowed, withErrorHandling, readJsonBody } from '../_lib/http.js';

// POST /api/auth/login
// Body: { email, password }
// Response: { token, must_change_password }
export default withErrorHandling(async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const body = await readJsonBody(req);
  const { email, password } = body;
  if (typeof email !== 'string' || typeof password !== 'string') {
    return sendJson(res, 400, { error: 'email and password are required' });
  }

  const { rows } = await query('SELECT * FROM admins WHERE email = $1', [email.toLowerCase()]);
  const admin = rows[0];

  // Constant-shape response whether the account exists or not, to avoid
  // leaking which emails are registered admins.
  if (!admin || !(await verifyPassword(password, admin.password_hash))) {
    await query(
      'INSERT INTO system_events (event_type, message, metadata) VALUES ($1, $2, $3)',
      ['auth_failed', 'Failed admin login attempt', JSON.stringify({ email })]
    );
    return sendJson(res, 401, { error: 'Invalid email or password' });
  }

  await query('UPDATE admins SET last_login_at = now() WHERE id = $1', [admin.id]);

  const token = issueToken(admin);
  return sendJson(res, 200, { token, must_change_password: admin.must_change_password });
});
