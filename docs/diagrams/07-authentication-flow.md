# Diagram 07: Authentication Flow

Covers the authentication flow implemented in the consolidated
`api/auth/[action].js` (login/register/me/change-password - one file, see
its header comment for why), `api/_lib/auth.js`, and
`api/_lib/http.js::requireAuth`/`requireAdmin`/`requireUser`. Full contract
detail in `docs/backend/authentication.md`.

```mermaid
sequenceDiagram
    participant User as User (browser, either role)
    participant Login as POST /api/auth/login
    participant DB as Postgres (users)
    participant Route as Any protected route

    User->>Login: {email, password}
    Login->>DB: SELECT * FROM users WHERE email = $1
    alt no match, bcrypt.compare fails, or is_active = false
        Login->>DB: INSERT system_events (auth_failed)
        Login-->>User: 401 {error: "Invalid email or password"}
    else match and active
        Login->>DB: UPDATE users SET last_login_at = now()
        Login-->>User: 200 {token, role, must_change_password}
    end

    Note over User: Dashboard stores the JWT\n(localStorage - see authentication.md\nfor the XSS tradeoff this implies)

    alt must_change_password == true
        User->>Route: POST /api/auth/change-password\nAuthorization: Bearer <token>\n{current_password, new_password}
        Route->>DB: verify current_password, UPDATE password_hash,\nmust_change_password = false
        Route-->>User: 200 {ok: true}
    end

    User->>Route: Any request with\nAuthorization: Bearer <token>
    Route->>Route: requireUser/requireAdmin(req, res)\n-> authenticateRequest -> jwt.verify (checks signature/expiry only)
    Route->>DB: SELECT id, email, role, is_active FROM users WHERE id = $1\n(fresh on EVERY request - never trusts the JWT's role/active state)
    alt token missing/invalid/expired
        Route-->>User: 401 {error: "Missing or invalid authentication token"}
    else account inactive or deleted
        Route-->>User: 401 {error: "Account is inactive or no longer exists"}
    else role required but doesn't match
        Route-->>User: 403 {error: "Insufficient permissions for this action"}
    else authorized
        Route-->>User: 200 {...}
    end
```

Key real details:

- JWTs are signed with `JWT_SECRET` (HS256 via `jsonwebtoken`), expire
  after **12 hours** (`JWT_EXPIRY = '12h'` in `api/_lib/auth.js`), and carry
  `{sub, email, role}` - but the `role` claim is a convenience/debugging
  snapshot only, **never trusted for authorization**. Every protected
  request re-reads the current role and `is_active` from the database
  (the `requireAuth` step above), so a role change or account deactivation
  takes effect on the very next request, not just the next time the token
  would otherwise be re-issued. This is deliberate and tested -
  `tests/integration/auth.integration.test.js`'s "a deactivated account is
  rejected at login and on an already-issued token" case issues a token
  *before* deactivating the account and confirms that same token is
  rejected on its next use.
- `must_change_password` defaults to `false`. It's only ever forced `true`
  by `scripts/seed_admin.js` (a seeded admin gets a temporary password); a
  self-registered user (`POST /api/auth/register`, always `role: 'user'`)
  chose their own password at signup, so it's never forced for them.
- The login response is deliberately the same shape whether the account
  doesn't exist, has the wrong password, or is deactivated
  (`Invalid email or password`), to avoid leaking account
  existence/state - the real reason is still logged server-side to
  `system_events.auth_failed`.
- Two roles exist (`admin`, `user`) with no finer-grained per-admin
  permissions - see `docs/limitations/security-limitations.md`.
