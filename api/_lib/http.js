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

/** Requires a valid admin JWT. Sends 401 and returns null if missing/invalid. */
export function requireAdmin(req, res) {
  const payload = authenticateRequest(req);
  if (!payload) {
    sendJson(res, 401, { error: 'Missing or invalid authentication token' });
    return null;
  }
  return payload;
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
