// Seeds (or updates) the default development admin account from
// ADMIN_EMAIL / ADMIN_PASSWORD environment variables. Never hard-codes
// production credentials - see .env.example and docs/backend/authentication.md.
import pg from 'pg';
import bcrypt from 'bcryptjs';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!connectionString) {
    console.error('DATABASE_URL is not set. See .env.example.');
    process.exit(1);
  }
  if (!email || !password) {
    console.error('ADMIN_EMAIL and ADMIN_PASSWORD must both be set. See .env.example.');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error('ADMIN_PASSWORD must be at least 10 characters.');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const passwordHash = await bcrypt.hash(password, 12);
  const normalizedEmail = email.toLowerCase();

  const { rows: existing } = await client.query('SELECT id FROM admins WHERE email = $1', [normalizedEmail]);

  if (existing.length > 0) {
    await client.query(
      'UPDATE admins SET password_hash = $1, must_change_password = true WHERE id = $2',
      [passwordHash, existing[0].id]
    );
    console.log(`Updated existing admin ${normalizedEmail}. must_change_password=true.`);
  } else {
    await client.query(
      'INSERT INTO admins (email, password_hash, must_change_password) VALUES ($1, $2, true)',
      [normalizedEmail, passwordHash]
    );
    console.log(`Created admin ${normalizedEmail}. must_change_password=true.`);
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
