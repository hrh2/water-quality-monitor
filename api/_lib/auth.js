// Authentication helpers shared by both roles (admin/user): password
// hashing (bcryptjs - pure JS, no native build step, safe on Vercel
// serverless) and JWT issue/verify.
//
// The JWT only carries `sub`/`email`/`role` as a convenience/debugging
// snapshot - it is NEVER trusted for authorization decisions. Every
// protected request re-reads the account's current role and is_active
// from the database (api/_lib/http.js::requireAuth), so a role change or
// deactivation takes effect on the very next request, not just the next
// time the token would otherwise be re-issued.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_EXPIRY = '12h';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set. See .env.example.');
  }
  return secret;
}

export async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, 12);
}

export async function verifyPassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

export function issueToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    getJwtSecret(),
    { expiresIn: JWT_EXPIRY }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}

/** Extracts and verifies the bearer token from a request's Authorization
 * header. Returns the decoded payload, or null if missing/invalid. Never
 * throws - callers should treat null as "unauthenticated" and respond 401. */
export function authenticateRequest(req) {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length);
  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}
