# Authentication

Covers the authentication and authorization design implemented in
`api/_lib/auth.js`, `api/_lib/http.js`, `api/auth/[action].js`, and
`scripts/seed_admin.js`. Device authentication (a separate, per-device
bcrypt token, not JWT-based) is covered in `docs/backend/api-contract.md`
(`POST /api/readings`) and `docs/diagrams/08-device-lifecycle.md`, not here.

## 1. Two roles, one auth system

`users.role` is `'admin'` or `'user'`. Both roles use identical password
hashing, JWT issuance, and login/change-password/`/me` logic - only
*authorization* (which endpoints a role may call) differs. This was a
deliberate choice over running two parallel auth systems: see
`docs/database/schema.md` and `docs/architecture/adr-002-ml-inference-runtime.md`-style
reasoning (avoid duplicating identical logic for a distinction that's
really just one column).

- **Admin-only**: device management, sensor/alert/system dashboards, user
  management (`api/_lib/http.js::requireAdmin`).
- **Any active user**: predictions (`POST /api/predict`,
  `GET /api/predictions`) and report export
  (`GET /api/reports/:type`) (`api/_lib/http.js::requireUser`).
- Full endpoint-by-endpoint breakdown: `docs/backend/api-contract.md`.

## 2. Password hashing

`bcryptjs` (pure JavaScript, no native build step - safe on Vercel
serverless, which is why it was chosen over the native `bcrypt` package) at
cost factor `12` (`hashPassword()`/`verifyPassword()` in `api/_lib/auth.js`).
Cost factor 12 is a standard, conservative default for interactive login
throughput; it is not separately benchmarked in this project.

## 3. JWT design

- Signed with `jsonwebtoken`, HS256 (library default), secret from
  `JWT_SECRET` (required - `getJwtSecret()` throws if unset, rather than
  falling back to a default secret).
- Payload: `{ sub: user.id, email: user.email, role: user.role }` - the
  `role` claim is a convenience/debugging snapshot only and is **never
  trusted for authorization decisions**. Every protected request re-reads
  the account's current `role` and `is_active` from the database
  (`requireAuth` in `api/_lib/http.js`), so a role change or account
  deactivation takes effect on the very next request, not just the next
  time a token would otherwise be re-issued. See
  `docs/diagrams/07-authentication-flow.md` for the full request sequence
  and the test that proves this (`tests/integration/auth.integration.test.js`).
- Expiry: **12 hours** (`JWT_EXPIRY = '12h'`).
- Verified via `authenticateRequest(req)`, which reads the
  `Authorization: Bearer <token>` header, calls `jwt.verify`, and returns
  `null` (never throws) on any failure. `requireAuth` then does the
  database re-check described above and returns the fresh `users` row (or
  sends 401/403 and returns `null`).
- No refresh-token mechanism exists; when a token expires, the user must
  log in again. See `docs/limitations/security-limitations.md`.

## 4. Registration and the forced password-change flow

Two ways an account is created, with different `must_change_password`
outcomes:

- **Self-registration** (`POST /api/auth/register`, public): always
  `role: 'user'`, `must_change_password: false` - the user chose their own
  password, so there's nothing to force them to change.
- **Seeded admin** (`scripts/seed_admin.js`): always
  `must_change_password: true`, even when re-seeding an existing email
  with a new password - a temporary/shared credential should always be
  changed on first real use.

`POST /api/auth/login` returns `must_change_password` in its response body
alongside the token, so the dashboard can force the change-password screen
before allowing further use. `POST /api/auth/change-password` verifies
`current_password`, requires `new_password` to be at least 10 characters,
and only then flips `must_change_password` to `false`.

This is enforced by the dashboard's flow (re-checked via a fresh
`GET /api/auth/me` on every page load, not just at login - see
`docs/diagrams/07-authentication-flow.md`'s "Key real details"), not by
the API rejecting other requests while `must_change_password` is true -
the JWT remains valid for other endpoints regardless. This is a documented
product-level nudge, not a hard server-side gate on every route.

## 5. Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `JWT_SECRET` | `api/_lib/auth.js` | Signs/verifies JWTs for both roles. Generate with `openssl rand -hex 32` (per `.env.example`). |
| `ADMIN_EMAIL` | `scripts/seed_admin.js` | Email for the seeded admin account. |
| `ADMIN_PASSWORD` | `scripts/seed_admin.js` | Initial password for the seeded admin account; must be >= 10 characters (script exits otherwise). |

Regular user accounts need no environment variables - they're created via
`POST /api/auth/register` at runtime, not seeded.

## 6. `scripts/seed_admin.js` behavior

Run via `npm run seed:admin`. Reads `DATABASE_URL`, `ADMIN_EMAIL`,
`ADMIN_PASSWORD` from the environment; exits with an error if any are
missing or if the password is under 10 characters. If a user with that
(lower-cased) email already exists (of either role - e.g. someone
self-registered with the email you want to promote), it **updates** the
row to `role = 'admin'`, sets the new password hash, and resets
`must_change_password = true` rather than failing; otherwise it inserts a
new row with `role = 'admin'`. This is currently the only way to promote
an account to admin - there is no in-app "make this user an admin" button
(see `docs/limitations/future-work.md`).

## 7. Honest limitation: token storage

The dashboard stores the issued JWT in **browser `localStorage`**
(`public/js/api.js`). This is a known, accepted tradeoff:

- **Risk**: `localStorage` is readable by any JavaScript that runs on the
  page's origin, so a successful XSS injection could exfiltrate the token
  directly, unlike an `httpOnly` cookie which JavaScript cannot read.
- **Why it was accepted here**: this project's scope is a small
  academic/demonstration system, not a production multi-tenant deployment.
  An `httpOnly` cookie approach would need CSRF protection and same-site
  cookie configuration work that isn't justified at this scale.
- **Not acceptable without hardening** for a real production deployment
  with untrusted user-supplied content anywhere in the console's render
  path (there currently is none, which is part of why the risk is
  currently low) - see `docs/limitations/security-limitations.md` for the
  full list of related gaps (no rate limiting, no refresh-token rotation,
  no email verification on registration, no admin-role promotion UI).
