# Diagram 07: Authentication Flow

Covers the admin authentication flow implemented in `api/auth/login.js`,
`api/auth/change-password.js`, `api/auth/me.js`, `api/_lib/auth.js`, and
`api/_lib/http.js::requireAdmin`. Full contract detail in
`docs/backend/authentication.md`.

```mermaid
sequenceDiagram
    participant Admin as Admin (browser)
    participant Login as POST /api/auth/login
    participant DB as Postgres (admins)
    participant Route as Any protected route

    Admin->>Login: {email, password}
    Login->>DB: SELECT * FROM admins WHERE email = $1
    alt no match or bcrypt.compare fails
        Login->>DB: INSERT system_events (auth_failed)
        Login-->>Admin: 401 {error: "Invalid email or password"}
    else match
        Login->>DB: UPDATE admins SET last_login_at = now()
        Login-->>Admin: 200 {token, must_change_password}
    end

    Note over Admin: Dashboard stores the JWT\n(localStorage - see authentication.md\nfor the XSS tradeoff this implies)

    alt must_change_password == true
        Admin->>Route: POST /api/auth/change-password\nAuthorization: Bearer <token>\n{current_password, new_password}
        Route->>DB: verify current_password, UPDATE password_hash,\nmust_change_password = false
        Route-->>Admin: 200 {ok: true}
    end

    Admin->>Route: Any request with\nAuthorization: Bearer <token>
    Route->>Route: requireAdmin(req, res)\n-> authenticateRequest -> jwt.verify
    alt token missing/invalid/expired
        Route-->>Admin: 401 {error: "Missing or invalid authentication token"}
    else valid
        Route->>DB: proceed with req.auth.sub as admin id
        Route-->>Admin: 200 {...}
    end
```

Key real details:

- JWTs are signed with `JWT_SECRET` (HS256 via `jsonwebtoken`), expire
  after **12 hours** (`JWT_EXPIRY = '12h'` in `api/_lib/auth.js`), and carry
  `{sub: admin.id, email: admin.email}`.
- `must_change_password` defaults to `true` for every newly seeded admin
  (`scripts/seed_admin.js`) and is only cleared by a successful
  `POST /api/auth/change-password` call.
- The login response is deliberately the same shape whether the email
  exists or not (`Invalid email or password`), to avoid leaking which
  emails are registered admins.
- There is exactly one admin-account model in this schema - no roles or
  per-admin permissions (see `docs/limitations/security-limitations.md`).
