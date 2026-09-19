import { query } from './_lib/db.js';
import { ingestReading, IngestError } from './_lib/ingest.js';
import { sendJson, methodNotAllowed, withErrorHandling, requireAdmin, readJsonBody } from './_lib/http.js';

// GET  /api/readings?device_id=&from=&to=&limit=   - query historical readings (admin)
// POST /api/readings                                - manual/testing ingestion path
//        (the firmware's real path is the WebSocket relay in api/ws.js;
//         this HTTP path uses the exact same api/_lib/ingest.js pipeline)
export default withErrorHandling(async function handler(req, res) {
  if (req.method === 'GET') {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const { device_id, from, to, limit } = req.query;
    const conditions = [];
    const params = [];

    if (device_id) {
      params.push(device_id);
      conditions.push(`r.device_id = $${params.length}`);
    }
    if (from) {
      params.push(from);
      conditions.push(`r.received_at >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`r.received_at <= $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const cappedLimit = Math.min(parseInt(limit, 10) || 200, 1000);

    const { rows } = await query(
      `SELECT r.id, r.device_id, r.ph, r.turbidity_ntu, r.tds_ppm, r.received_at, r.is_valid,
              p.water_quality_category, p.prediction_confidence, p.contamination_risk
       FROM sensor_readings r
       LEFT JOIN predictions p ON p.reading_id = r.id
       ${where}
       ORDER BY r.received_at DESC
       LIMIT ${cappedLimit}`,
      params
    );
    return sendJson(res, 200, { readings: rows });
  }

  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    try {
      const enriched = await ingestReading(body);
      return sendJson(res, 201, enriched);
    } catch (err) {
      if (err instanceof IngestError) {
        return sendJson(res, err.statusCode, { error: err.message });
      }
      throw err;
    }
  }

  return methodNotAllowed(res, ['GET', 'POST']);
});
