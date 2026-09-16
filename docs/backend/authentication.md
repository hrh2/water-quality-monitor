# Authentication

Covers the admin authentication design implemented in `api/_lib/auth.js`,
`api/auth/*.js`, and `scripts/seed_admin.js`. Device authentication (a
separate, per-device bcrypt token, not JWT-based) is covered in
`docs/backend/api-contract.md` (`POST /api/readings`) and
`docs/diagrams/08-device-lifecycle.md`, not here.

## 1. Password hashing

`bcryptjs` (pure JavaScript, no native build step - safe on Vercel
serverless, which is why it was chosen over the native `bcrypt` package) at
cost factor `12` (`hashPassword()`/`verifyPassword()` in `api/_lib/auth.js`).
Cost factor 12 is a standard, conservative default for interactive login
throughput; it is not separately benchmarked in this project.

## 2. JWT design

- Signed with `jsonwebtoken`, HS256 (library default), secret from
  `JWT_SECRET` (required - `getJwtSecret()` throws if unset, rather than
  falling back to a default secret).
- Payload: `{ sub: admin.id, email: admin.email }`.
- Expiry: **12 hours** (`JWT_EXPIRY = '12h'`).
- Verified via `authenticateRequest(req)`, which reads the
  `Authorization: Bearer <token>` header, calls `jwt.verify`, and returns
  `null` (never throws) on any failure - callers (`requireAdmin`) treat
  `null` as unauthenticated and respond `401`.
- No refresh-token mechanism exists; when a token expires, the admin must
  log in again. See `docs/limitations/security-limitations.md`.

## 3. Forced password change flow

Every admin row has `must_change_password BOOLEAN NOT NULL DEFAULT TRUE`.
`scripts/seed_admin.js` always sets this `true` when creating **or
updating** an admin account (even on re-seeding an existing email with a
new password). `POST /api/auth/login` returns this flag in its response
body alongside the token, so the dashboard can force the change-password
screen before allowing further use. `POST /api/auth/change-password`
verifies `current_password`, requires `new_password` to be at least 10
characters, and only then flips `must_change_password` to `false`.

This is enforced by the dashboard's flow, not by the API rejecting other
requests while `must_change_password` is true - the JWT remains valid for
other endpoints regardless. This is a documented product-level nudge, not
a hard server-side gate on every route.

## 4. Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `JWT_SECRET` | `api/_lib/auth.js` | Signs/verifies admin JWTs. Generate with `openssl rand -hex 32` (per `.env.example`). |
| `ADMIN_EMAIL` | `scripts/seed_admin.js` | Email for the seeded admin account. |
| `ADMIN_PASSWORD` | `scripts/seed_admin.js` | Initial password for the seeded admin account; must be >= 10 characters (script exits otherwise). |

## 5. `scripts/seed_admin.js` behavior

Run via `npm run seed:admin`. Reads `DATABASE_URL`, `ADMIN_EMAIL`,
`ADMIN_PASSWORD` from the environment; exits with an error if any are
missing or if the password is under 10 characters. If an admin with that
(lower-cased) email already exists, it **updates** the password hash and
resets `must_change_password = true` rather than failing; otherwise it
inserts a new row. Never hard-codes production credentials.

## 6. Honest limitation: token storage

The dashboard is expected to store the issued JWT in **browser
`localStorage`** (this is a statement about the intended client design,
not something implemented in the `api/` routes documented here, since the
dashboard is a separate work stream). This is a known, accepted tradeoff:

- **Risk**: `localStorage` is readable by any JavaScript that runs on the
  page's origin, so a successful XSS injection could exfiltrate the token
  directly, unlike an `httpOnly` cookie which JavaScript cannot read.
- **Why it was accepted here**: this project's scope is a small,
  single-admin-account academic/demonstration system, not a
  production multi-tenant deployment. An `httpOnly` cookie approach would
  need CSRF protection and same-site cookie configuration work that isn't
  justified at this scale.
- **Not acceptable without hardening** for a real production deployment
  with untrusted user-supplied content anywhere in the admin UI's render
  path (there currently is none, which is part of why the risk is
  currently low) - see `docs/limitations/security-limitations.md` for the
  full list of related gaps (no rate limiting, no refresh-token rotation,
  single-admin model).
