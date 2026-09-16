# Security Limitations

Honest gaps in the current implementation, as of the code actually in this
repository. None of these are hidden - each is either commented in the
source or a direct consequence of a documented design tradeoff.

## 1. No rate limiting on any endpoint

Neither the admin REST API (`api/*.js`) nor the device ingestion path
(`api/ws.js`, `POST /api/readings`) implements request-rate limiting.
`POST /api/auth/login` has no lockout/backoff after repeated failed
attempts (each failure is logged to `system_events` as `auth_failed`, but
nothing currently acts on that log to throttle further attempts). A
credential-stuffing or brute-force attempt against `/api/auth/login`, or a
flood of `POST /api/readings` calls, is not mitigated by the application
layer.

## 2. JWT stored in browser localStorage (XSS exposure)

Covered in full in `docs/backend/authentication.md` §6: the dashboard is
expected to keep the admin JWT in `localStorage`, which is readable by any
JavaScript executing on the page's origin. This is an accepted tradeoff for
this project's academic/demonstration scope, not something suitable for a
production deployment handling untrusted user content without further
hardening (e.g. moving to an `httpOnly` cookie plus CSRF protection).

## 3. No refresh-token rotation

`api/_lib/auth.js` issues a single JWT with a fixed 12-hour expiry
(`JWT_EXPIRY = '12h'`) and no refresh token mechanism. There is no way to
revoke a specific issued token before it expires short of rotating
`JWT_SECRET` (which invalidates every outstanding token, not just one).

## 4. No audit log beyond `system_events`

`system_events` records operational events (device registration, auth
failures, rejected readings, unhandled errors) but is not a structured,
queryable security audit log - there's no per-admin action history (e.g.
"admin X acknowledged alert Y at time Z" is visible in the `alerts` table
via `acknowledged_by`/`acknowledged_at`, but there's no general-purpose
admin action log covering every mutating request).

## 5. Single-admin-account model, no RBAC

`admins` has no role/permission column - every admin row has identical,
full access to every admin-only route. There is no concept of a
read-only admin, a per-device-scoped admin, or any other permission tier.

## 6. Firmware `set_config`-over-WebSocket hijack risk

Quoted directly from `firmware/firmware.ino`'s own comments (also in
`docs/firmware/behavior.md` §1c):

> since this arrives authenticated only by an already-open WS connection,
> make sure your server only opens/authorizes that connection using the
> current valid device_token before sending a set_config message -
> otherwise anyone able to reach your WS endpoint could hijack a device's
> identity.

In the current backend, `api/ws.js` does not perform a handshake-time
token check before accepting a WebSocket connection - authentication
happens per-message, inside `ingestReading()`, when a message carrying a
`token` field arrives. This means the *connection* itself is not gated by
device identity before any `set_config` push could theoretically be sent
to whatever is on the other end of an open socket. This is a real,
un-mitigated gap consistent with the firmware's own documented caveat, not
a hypothetical one.

## 7. `ssl: { rejectUnauthorized: false }` in `api/_lib/db.js`

```js
ssl: connectionString.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
```

When a `DATABASE_URL` doesn't explicitly disable SSL, the connection still
uses TLS, but **does not validate the server's certificate against a
trusted CA list** (`rejectUnauthorized: false`). This is a common
practical workaround because Node's default trust store in a serverless
runtime doesn't always include the CA chain a given managed Postgres
provider (Neon, Supabase, Vercel Postgres) uses for its endpoint
certificates, and provider-specific CA bundling adds real operational
complexity. The consequence: the connection is still encrypted
in-transit, but is not protected against a man-in-the-middle presenting an
arbitrary certificate - this is a **reduced-rigor tradeoff, not full
certificate validation**, and should be called out as such rather than
presented as equivalent to a fully verified TLS connection.

## Summary

None of the above are exploited or demonstrated in this repository - they
are documented as known, present gaps appropriate to this project's
current academic/demonstration scope. See
`docs/limitations/future-work.md` for the realistic next steps to close
each of them.
