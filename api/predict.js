import { predictWaterQuality, getModelMetadata } from './_lib/predict.js';
import { query } from './_lib/db.js';
import { sendJson, methodNotAllowed, withErrorHandling, requireUser, readJsonBody } from './_lib/http.js';

// POST /api/predict
// Body: { ph?: number|null, turbidity_ntu: number, tds_ppm: number }
// Ad-hoc "what-if" prediction utility (any active user, admin or
// self-registered). Used by the ML dashboard tab to explore the model, by
// tests to verify JS/Python parity, and - since it's logged to
// `prediction_requests` below - to power the per-user dashboard's usage
// stats (see docs/database/schema.md for why this is a separate table
// from `predictions`, which is tied to real sensor readings, not what-if
// queries).
export default withErrorHandling(async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const auth = await requireUser(req, res);
  if (!auth) return;

  const { ph, turbidity_ntu, tds_ppm } = await readJsonBody(req);
  if (typeof turbidity_ntu !== 'number' || typeof tds_ppm !== 'number') {
    return sendJson(res, 400, { error: 'turbidity_ntu and tds_ppm are required numbers; ph is optional' });
  }

  const prediction = predictWaterQuality({ ph: ph ?? null, turbidity_ntu, tds_ppm });

  await query(
    `INSERT INTO prediction_requests (user_id, ph, turbidity_ntu, tds_ppm, water_quality_category, prediction_confidence, class_probabilities)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      auth.id,
      ph ?? null,
      turbidity_ntu,
      tds_ppm,
      prediction.water_quality_category,
      prediction.prediction_confidence,
      JSON.stringify(prediction.class_probabilities),
    ]
  );

  return sendJson(res, 200, { ...prediction, model: getModelMetadata() });
});
