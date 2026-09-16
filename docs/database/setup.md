# Database Setup

## 1. Provision a Postgres instance

Any standard managed Postgres provider works, since the application only
ever talks to it through a `DATABASE_URL` connection string via the `pg`
driver (`api/_lib/db.js`) - see `docs/architecture/adr-001-database-choice.md`
for why. Options that work identically:

- **Neon** (recommended pooled connection string)
- **Supabase**
- **Vercel Postgres**
- Any other standard Postgres host

Whichever provider you use, copy its connection string into `DATABASE_URL`.
If a provider offers both a "direct" and a "pooled" connection string,
prefer the pooled one, since each Vercel Function instance already opens
its own small pool (`max: 5`) on top of it.

## 2. Environment variables

Copy `.env.example` to `.env` (local dev) and fill in real values:

```
DATABASE_URL=postgres://user:password@host:5432/dbname?sslmode=require
JWT_SECRET=replace-with-a-long-random-string   # openssl rand -hex 32
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-this-dev-password
```

Never commit a real `.env` file.

## 3. Apply migrations

```
npm run migrate
```

Runs `scripts/apply_migrations.js`, which:
- creates a `schema_migrations` tracking table if it doesn't exist,
- applies every `.sql` file in `db/migrations/` (currently just
  `0001_init.sql`) in filename order, skipping any already recorded as
  applied,
- wraps each migration in its own transaction (`BEGIN`/`COMMIT`, rolled
  back on error).

## 4. Seed the admin account

```
npm run seed:admin
```

Runs `scripts/seed_admin.js`, which creates (or updates) the admin row from
`ADMIN_EMAIL`/`ADMIN_PASSWORD`, always leaving `must_change_password =
true`. See `docs/backend/authentication.md`.

## 5. Register the current trained model

```
npm run seed:model-version
```

Runs `scripts/seed_model_version.js`, which reads
`ml/models/model_metadata.json` and inserts (or replaces the active) row in
`model_versions`, so `predictions.model_version_id` has something to point
at and `GET /api/system/health` reports real model metadata. Run this after
retraining - see `docs/machine-learning/retraining.md`.

## 6. Local throwaway Postgres for integration testing

See `tests/README.md` for the exact from-scratch steps (initdb, a
short-path Unix socket directory, `createdb`, and running
`scripts/apply_migrations.js` against it with `&sslmode=disable`) used to
stand up a disposable local instance for `tests/integration/`.
