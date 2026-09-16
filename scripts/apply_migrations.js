// Applies every .sql file in db/migrations/, in filename order, that
// hasn't been applied yet. Intentionally simple (no ORM) - see
// docs/database/setup.md for why.
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. See .env.example.');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const { rows } = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
    if (rows.length > 0) {
      console.log(`Skipping already-applied migration: ${file}`);
      continue;
    }

    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    console.log(`Applying migration: ${file}`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }

  await client.end();
  console.log('Migrations complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
