# Tests - Quick Start

See `docs/testing/testing.md` for the full description of what each layer
covers. This file is just the practical steps to run everything, including
standing up a throwaway local Postgres for `tests/integration/`.

## Backend + integration unit tests (Node)

```
npm test
```

Runs `node --test`, which picks up `tests/backend/*.test.js` and
`tests/integration/*.test.js`. The integration test self-skips unless
`DATABASE_URL` and `JWT_SECRET` are both set in the environment (see
below for a disposable local Postgres to point it at).

## ML tests (Python)

From the repository root:

```
ml/.venv/bin/pytest tests/ml
```

## Standing up a throwaway local Postgres for integration testing

These are the exact steps used to get `tests/integration/ingest.integration.test.js`
running locally without touching a real/shared database.

```bash
# 1. Initialize a new local data directory
initdb -D /tmp/wqm-pg-test

# 2. Start postgres with a SHORT unix socket directory path.
#    WARNING: Postgres's unix socket path has a ~107-byte limit. A long
#    /tmp path (common on some systems/CI runners) can silently exceed
#    this and fail to start - use a short path like /tmp/pgsock, not a
#    long nested temp directory.
mkdir -p /tmp/pgsock
postgres -D /tmp/wqm-pg-test -k /tmp/pgsock -p 5433 &

# 3. Create the test database
createdb -h /tmp/pgsock -p 5433 wqm_test

# 4. Apply migrations against it
DATABASE_URL="postgresql://localhost:5433/wqm_test?host=/tmp/pgsock&sslmode=disable" \
  node scripts/apply_migrations.js

# 5. Run the tests against it
DATABASE_URL="postgresql://localhost:5433/wqm_test?host=/tmp/pgsock&sslmode=disable" \
JWT_SECRET="test-secret" \
  npm test
```

`&sslmode=disable` is required here because a local, non-TLS Postgres
instance will otherwise be rejected by `api/_lib/db.js`'s SSL handling
(which only disables SSL when the connection string itself says
`sslmode=disable` - see `docs/database/setup.md` and
`docs/limitations/security-limitations.md` for the related
`rejectUnauthorized: false` tradeoff on real, TLS-enabled connections).

## Cleaning up

```bash
kill %1   # stop the postgres process started above
rm -rf /tmp/wqm-pg-test /tmp/pgsock
```
