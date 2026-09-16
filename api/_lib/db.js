// Shared Postgres connection pool for all API routes.
//
// Vercel Functions are short-lived and can run as many concurrent
// instances; a large connection pool per instance would exhaust a small
// Postgres plan's connection limit. Keep `max` small and rely on the
// database provider's own connection pooler (e.g. Neon's pooled
// connection string, which every provider documented in
// docs/database/setup.md supports) for the real fan-out.
import pg from 'pg';

const { Pool } = pg;

let pool;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is not set. See .env.example and docs/database/setup.md.'
      );
    }
    pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 10_000,
      ssl: connectionString.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}
