// Alert creation from a reading + prediction + contamination assessment.
import { query } from './db.js';

const CATEGORY_SEVERITY = {
  Safe: null, // no alert
  Moderate: null, // no alert on category alone
  Unsafe: 'warning',
  Critical: 'critical',
};

// Avoid alert-flooding: don't create a new alert for the same device if an
// active one already exists within this window (the underlying condition
// is still visible via the existing alert; a fresh reading every ~3s
// shouldn't each spawn a new row).
const DEDUP_WINDOW_MINUTES = 15;

export async function createAlertsIfNeeded({ deviceId, readingId, category, contamination }) {
  const reasons = [];
  let severity = CATEGORY_SEVERITY[category] ?? null;

  if (contamination.contamination_risk) {
    severity = severity === 'critical' ? 'critical' : 'warning';
    reasons.push(...contamination.reasons);
  }
  if (severity === null) return null;
  if (reasons.length === 0) reasons.push(`predicted category is ${category}`);

  const { rows: existing } = await query(
    `SELECT id FROM alerts
     WHERE device_id = $1 AND status = 'active'
       AND created_at > now() - ($2 || ' minutes')::interval
     LIMIT 1`,
    [deviceId, DEDUP_WINDOW_MINUTES]
  );
  if (existing.length > 0) return null;

  const { rows } = await query(
    `INSERT INTO alerts (device_id, reading_id, severity, reason, status)
     VALUES ($1, $2, $3, $4, 'active')
     RETURNING id, device_id, severity, reason, status, created_at`,
    [deviceId, readingId, severity, reasons.join('; ')]
  );
  return rows[0];
}
