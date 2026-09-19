// Small shared helpers for plain (req, res) Vercel Node function handlers.
// Deliberately not Express - these routes are simple JSON in/out and don't
// need routing/middleware machinery beyond what's here.
import { authenticateRequest } from './auth.js';
import { query } from './db.js';

export function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  sendJson(res, 405, { error: `Method not allowed. Use: ${allowed.join(', ')}` });
}

/** Requires a valid JWT AND re-checks the account's current state in the
 * database on every call (not just at login) - so deactivating a user
 * takes effect immediately, on their very next request, rather than only
 * the next time they'd otherwise log in. Optionally restricts to a role
 * ('admin'). Sends 401/403 and returns null on failure; otherwise returns
 * the fresh `users` row. */
export async function requireAuth(req, res, { role } = {}) {
  const payload = authenticateRequest(req);
  if (!payload) {
    sendJson(res, 401, { error: 'Missing or invalid authentication token' });
    return null;
  }

  const { rows } = await query(
    'SELECT id, email, role, is_active, must_change_password, first_name, last_name, created_at, last_login_at FROM users WHERE id = $1',
    [payload.sub]
  );
  const user = rows[0];
  if (!user || !user.is_active) {
    sendJson(res, 401, { error: 'Account is inactive or no longer exists' });
    return null;
  }
  if (role && user.role !== role) {
    sendJson(res, 403, { error: 'Insufficient permissions for this action' });
    return null;
  }
  return user;
}

/** Requires an authenticated, active user of ANY role. */
export function requireUser(req, res) {
  return requireAuth(req, res);
}

/** Requires an authenticated, active user with role='admin'. */
export function requireAdmin(req, res) {
  return requireAuth(req, res, { role: 'admin' });
}

/** Wraps a handler so unexpected errors become a safe generic 500 instead of
 * leaking stack traces / internal details to the client (section 18/19 of
 * the project spec: no internal errors exposed to users). Full detail is
 * still logged server-side and recorded to system_events for the admin
 * dashboard's "System" tab. */
export function withErrorHandling(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error(err);
      try {
        await query(
          'INSERT INTO system_events (event_type, message, metadata) VALUES ($1, $2, $3)',
          ['unhandled_error', err.message || 'Unknown error', JSON.stringify({ stack: err.stack, path: req.url })]
        );
      } catch (logErr) {
        console.error('Failed to record system_event for error:', logErr);
      }
      sendJson(res, 500, { error: 'Internal server error' });
    }
  };
}

export async function readJsonBody(req) {
  if (req.body !== undefined) {
    // Vercel's Node runtime may already have parsed JSON bodies.
    return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  return raw ? JSON.parse(raw) : {};
}
