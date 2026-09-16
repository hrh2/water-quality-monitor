// Admin authentication helpers: password hashing (bcryptjs - pure JS, no
// native build step, safe on Vercel serverless) and JWT issue/verify.
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

export function issueToken(admin) {
  return jwt.sign(
    { sub: admin.id, email: admin.email },
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
