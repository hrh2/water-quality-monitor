import { predictWaterQuality, getModelMetadata } from './_lib/predict.js';
import { sendJson, methodNotAllowed, withErrorHandling, requireAdmin, readJsonBody } from './_lib/http.js';

// POST /api/predict
// Body: { ph?: number|null, turbidity_ntu: number, tds_ppm: number }
// Ad-hoc "what-if" prediction utility (admin-only) - does NOT persist
// anything. Used by the ML dashboard tab to explore the model, and by
// tests to verify Python/JS inference parity.
export default withErrorHandling(async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const auth = requireAdmin(req, res);
  if (!auth) return;

  const { ph, turbidity_ntu, tds_ppm } = await readJsonBody(req);
  if (typeof turbidity_ntu !== 'number' || typeof tds_ppm !== 'number') {
    return sendJson(res, 400, { error: 'turbidity_ntu and tds_ppm are required numbers; ph is optional' });
  }

  const prediction = predictWaterQuality({ ph: ph ?? null, turbidity_ntu, tds_ppm });
  return sendJson(res, 200, { ...prediction, model: getModelMetadata() });
});
