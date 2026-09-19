-- Multi-user support: replaces the single-role `admins` table with a
-- `users` table that has a `role` column ('admin' | 'user'). One unified
-- auth system instead of two parallel ones (admins vs. users) - login,
-- password hashing, and JWT issuance are identical for both roles; only
-- authorization (which endpoints a role may call) differs, enforced in
-- api/_lib/http.js::requireAuth. See docs/database/schema.md and
-- docs/backend/authentication.md.
--
-- Design notes:
--   - `is_active` gates login AND every subsequent authenticated request
--     (api/_lib/http.js re-checks it from the database on every call, not
--     just at login) so deactivating a user takes effect immediately,
--     not just the next time they'd otherwise log in.
--   - Self-registered users always get role='user' and
--     must_change_password=false (they chose their own password at
--     signup, unlike a seeded admin's temporary one) - see
--     api/auth/[action].js's register handler.
--   - The existing admin account(s) are migrated in place with role='admin'
--     so nobody needs to re-register after this migration runs.

CREATE TABLE users (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                 TEXT NOT NULL UNIQUE,
    password_hash         TEXT NOT NULL,
    role                  TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    must_change_password  BOOLEAN NOT NULL DEFAULT FALSE,
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at         TIMESTAMPTZ
);

CREATE INDEX idx_users_role ON users (role);

INSERT INTO users (id, email, password_hash, role, must_change_password, is_active, created_at, last_login_at)
SELECT id, email, password_hash, 'admin', must_change_password, TRUE, created_at, last_login_at
FROM admins;

ALTER TABLE alerts DROP CONSTRAINT alerts_acknowledged_by_fkey;
ALTER TABLE alerts ADD CONSTRAINT alerts_acknowledged_by_fkey
    FOREIGN KEY (acknowledged_by) REFERENCES users(id);

DROP TABLE admins;
