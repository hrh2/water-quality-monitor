# ADR-001: Database Choice - PostgreSQL via a Plain Connection String

## Status

Accepted.

## Context

The system needs durable storage for admins, devices, sensor readings, ML
predictions, alerts, and a system event log
(`db/migrations/0001_init.sql`), accessed from Vercel Node.js Serverless
Functions (`api/*.js`). The project's stated principles favor simple,
Vercel-compatible choices and avoiding unnecessary abstraction over
architectural generality that isn't needed.

Two axes of decision were involved: which database engine, and how to
manage its schema.

## Decision

**Engine: PostgreSQL, addressed purely through a `DATABASE_URL` connection
string.** `api/_lib/db.js` opens a `pg.Pool` against whatever
`DATABASE_URL` points at. Neon, Supabase, and Vercel Postgres (or any other
standard managed Postgres) all work identically, because none of the
application code depends on a provider-specific SDK - only on the Postgres
wire protocol via the `pg` driver. `docs/database/setup.md` documents
provisioning for any of these providers side by side for exactly this
reason.

**Schema management: plain `.sql` migration files, no ORM.** Every schema
change lives as a numbered file in `db/migrations/` (currently
`0001_init.sql`), applied in filename order by `scripts/apply_migrations.js`,
which tracks what has already run in a `schema_migrations` table it creates
itself. There is no Prisma/Drizzle/TypeORM layer: routes call
`api/_lib/db.js::query()` with hand-written SQL. For a schema this size
(seven tables, no polymorphic relationships), an ORM would add a dependency,
a build step, and a layer of query-generation to reason about, without a
proportional benefit - directly matching the project's "prefer simple,
avoid unnecessary abstraction" principle.

**Connection pooling: a small `pg.Pool` (`max: 5`) per serverless
instance**, not one large pool. Vercel can run many concurrent Function
instances, each of which would open its own pool; a large `max` per
instance would exhaust a small Postgres plan's total connection limit
quickly. The design instead relies on the provider's own connection pooler
(e.g. Neon's pooled connection string, PgBouncer-backed) for the real
fan-out across many concurrent serverless instances, keeping each
instance's own pool small and cheap. This is implemented in
`api/_lib/db.js`:

```js
pool = new Pool({
  connectionString,
  max: 5,
  idleTimeoutMillis: 10_000,
  ssl: connectionString.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
});
```

## Consequences

- Any Postgres-compatible provider works with zero code changes - only an
  environment variable changes between them. See `docs/database/setup.md`.
- Schema evolution is a plain, auditable SQL diff in version control, with
  a minimal custom runner (`scripts/apply_migrations.js`) instead of a
  migration framework's generated files and metadata tables.
- `ssl: { rejectUnauthorized: false }` is a deliberate, documented
  reduced-rigor tradeoff (most managed Postgres providers' certificates
  aren't in Node's default trust store in a serverless context) - see
  `docs/limitations/security-limitations.md` for the full discussion; it is
  not full certificate validation and is called out there rather than
  presented as a non-issue.
- There is no separate read-replica or caching layer; every route queries
  Postgres directly. For this project's traffic (one device, a handful of
  admin dashboard viewers), this is adequate and consistent with avoiding
  premature scaling machinery.
