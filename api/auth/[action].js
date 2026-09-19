// Consolidated auth endpoint: login, register, me, change-password.
//
// Why one file instead of four (as it used to be): Vercel's Hobby plan
// caps a deployment at 12 Serverless Functions, and every file under api/
// (outside api/_lib/, which is excluded by its underscore prefix - see
// docs/deployment/vercel.md) counts as one. Adding user registration plus
// the user-management and reports endpoints for this feature would have
// pushed the total over the limit, so the four auth actions - none of
// which do meaningfully different request parsing - are dispatched from
// one dynamic route by URL segment (`/api/auth/:action`) instead of one
// file each. See docs/deployment/vercel.md for the full accounting.
import { query } from '../_lib/db.js';
import { hashPassword, verifyPassword, issueToken } from '../_lib/auth.js';
import { sendJson, methodNotAllowed, withErrorHandling, requireUser, readJsonBody } from '../_lib/http.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 10;

// POST /api/auth/login
// Body: { email, password } -> { token, role, must_change_password }
async function handleLogin(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const { email, password } = await readJsonBody(req);
  if (typeof email !== 'string' || typeof password !== 'string') {
    return sendJson(res, 400, { error: 'email and password are required' });
  }

  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  const user = rows[0];

  // Constant-shape response whether the account exists, is wrong-password,
  // or is deactivated, to avoid leaking account existence/state to a
  // guesser - but log the real reason server-side for the System tab.
  if (!user || !(await verifyPassword(password, user.password_hash)) || !user.is_active) {
    await query(
      'INSERT INTO system_events (event_type, message, metadata) VALUES ($1, $2, $3)',
      ['auth_failed', 'Failed login attempt', JSON.stringify({ email, reason: !user ? 'no_such_user' : !user.is_active ? 'inactive' : 'bad_password' })]
    );
    return sendJson(res, 401, { error: 'Invalid email or password' });
  }

  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

  const token = issueToken(user);
  return sendJson(res, 200, {
    token,
    role: user.role,
    must_change_password: user.must_change_password,
    first_name: user.first_name,
  });
}

// POST /api/auth/register
// Body: { email, password, first_name, last_name } -> { token, role: 'user', must_change_password: false, first_name }
// Public self-registration always creates role='user' - there is no way
// to self-register as admin (the seeded account, or promotion by an
// existing admin - not yet built, see docs/limitations/future-work.md -
// are the only paths to role='admin'). Name is required so the dashboard
// can greet the person by name after login (see docs/frontend/dashboard.md) -
// it is display-only, never used for authentication.
async function handleRegister(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const { email, password, first_name, last_name } = await readJsonBody(req);
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return sendJson(res, 400, { error: 'A valid email is required' });
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return sendJson(res, 400, { error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  if (typeof first_name !== 'string' || first_name.trim().length === 0) {
    return sendJson(res, 400, { error: 'first_name is required' });
  }
  if (typeof last_name !== 'string' || last_name.trim().length === 0) {
    return sendJson(res, 400, { error: 'last_name is required' });
  }

  const normalizedEmail = email.toLowerCase();
  const { rows: existing } = await query('SELECT 1 FROM users WHERE email = $1', [normalizedEmail]);
  if (existing.length > 0) {
    return sendJson(res, 409, { error: 'An account with this email already exists' });
  }

  const passwordHash = await hashPassword(password);
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, role, must_change_password, is_active, first_name, last_name)
     VALUES ($1, $2, 'user', false, true, $3, $4)
     RETURNING id, email, role, first_name`,
    [normalizedEmail, passwordHash, first_name.trim(), last_name.trim()]
  );
  const user = rows[0];

  await query(
    'INSERT INTO system_events (event_type, message, metadata) VALUES ($1, $2, $3)',
    ['user_registered', `New user registered: ${normalizedEmail}`, JSON.stringify({ user_id: user.id })]
  );

  const token = issueToken(user);
  return sendJson(res, 201, { token, role: 'user', must_change_password: false, first_name: user.first_name });
}

// GET /api/auth/me - the authenticated user's own profile (any role).
async function handleMe(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const auth = await requireUser(req, res);
  if (!auth) return;

  return sendJson(res, 200, {
    id: auth.id,
    email: auth.email,
    role: auth.role,
    must_change_password: auth.must_change_password,
    first_name: auth.first_name,
    last_name: auth.last_name,
  });
}

// POST /api/auth/change-password (any role, changes your own password)
// Body: { current_password, new_password } -> { ok: true }
async function handleChangePassword(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const auth = await requireUser(req, res);
  if (!auth) return;

  const { current_password, new_password } = await readJsonBody(req);
  if (typeof current_password !== 'string' || typeof new_password !== 'string') {
    return sendJson(res, 400, { error: 'current_password and new_password are required' });
  }
  if (new_password.length < MIN_PASSWORD_LENGTH) {
    return sendJson(res, 400, { error: `new_password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const { rows } = await query('SELECT * FROM users WHERE id = $1', [auth.id]);
  const user = rows[0];
  if (!user || !(await verifyPassword(current_password, user.password_hash))) {
    return sendJson(res, 401, { error: 'current_password is incorrect' });
  }

  const newHash = await hashPassword(new_password);
  await query(
    'UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2',
    [newHash, user.id]
  );

  return sendJson(res, 200, { ok: true });
}

const ACTIONS = {
  login: handleLogin,
  register: handleRegister,
  me: handleMe,
  'change-password': handleChangePassword,
};

export default withErrorHandling(async function handler(req, res) {
  const { action } = req.query;
  const fn = ACTIONS[action];
  if (!fn) return sendJson(res, 404, { error: `Unknown auth action: ${action}` });
  return fn(req, res);
});
