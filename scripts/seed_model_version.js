// Registers the currently-trained model (ml/models/model_metadata.json) as
// a row in model_versions, deactivating any previously active version.
// Run this after ml/training/train.py + ml/inference/export_portable_model.py.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const METADATA_PATH = path.join(__dirname, '..', 'ml', 'models', 'model_metadata.json');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. See .env.example.');
    process.exit(1);
  }

  const metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf-8'));

  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  await client.query('BEGIN');
  await client.query('UPDATE model_versions SET is_active = false WHERE is_active');
  await client.query(
    `INSERT INTO model_versions (model_name, trained_at, metrics, is_active, notes)
     VALUES ($1, $2, $3, true, $4)`,
    [
      metadata.selected_for_deployment ?? metadata.model_name,
      metadata.trained_at_utc,
      JSON.stringify(metadata.final_test_metrics),
      metadata.deployability_note ?? null,
    ]
  );
  await client.query('COMMIT');
  await client.end();

  console.log(`Registered model version: ${metadata.selected_for_deployment ?? metadata.model_name}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
