import { query } from './_lib/db.js';
import { sendJson, methodNotAllowed, withErrorHandling, requireUser } from './_lib/http.js';

// GET /api/predictions?category=&device_id=&limit=
// Lists recent stored predictions (joined with their reading) plus overall
// class distribution, for the ML dashboard tab. Any active user (admin or
// self-registered) can view this - it's not per-user-scoped data.
export default withErrorHandling(async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const auth = await requireUser(req, res);
  if (!auth) return;

  const { category, device_id, limit } = req.query;
  const conditions = [];
  const params = [];

  if (category) {
    params.push(category);
    conditions.push(`p.water_quality_category = $${params.length}`);
  }
  if (device_id) {
    params.push(device_id);
    conditions.push(`r.device_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const cappedLimit = Math.min(parseInt(limit, 10) || 100, 500);

  const { rows: predictions } = await query(
    `SELECT p.id, p.water_quality_category, p.prediction_confidence, p.class_probabilities,
            p.contamination_risk, p.created_at, r.device_id, r.ph, r.turbidity_ntu, r.tds_ppm
     FROM predictions p
     JOIN sensor_readings r ON r.id = p.reading_id
     ${where}
     ORDER BY p.created_at DESC
     LIMIT ${cappedLimit}`,
    params
  );

  const { rows: distribution } = await query(
    `SELECT water_quality_category, count(*) AS count
     FROM predictions GROUP BY water_quality_category`
  );

  return sendJson(res, 200, { predictions, class_distribution: distribution });
});
