import { query } from './_lib/db.js';
import { sendJson, methodNotAllowed, withErrorHandling, requireAdmin, readJsonBody } from './_lib/http.js';

// GET   /api/alerts?status=active           - list alerts
// PATCH /api/alerts  { id, action }          - action: 'acknowledge' | 'resolve'
export default withErrorHandling(async function handler(req, res) {
  const auth = requireAdmin(req, res);
  if (!auth) return;

  if (req.method === 'GET') {
    const { status } = req.query;
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE status = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT * FROM alerts ${where} ORDER BY created_at DESC LIMIT 200`,
      params
    );
    return sendJson(res, 200, { alerts: rows });
  }

  if (req.method === 'PATCH') {
    const { id, action } = await readJsonBody(req);
    if (!id || !['acknowledge', 'resolve'].includes(action)) {
      return sendJson(res, 400, { error: "id and action ('acknowledge'|'resolve') are required" });
    }

    if (action === 'acknowledge') {
      const { rows } = await query(
        `UPDATE alerts SET status = 'acknowledged', acknowledged_at = now(), acknowledged_by = $1
         WHERE id = $2 RETURNING *`,
        [auth.sub, id]
      );
      if (rows.length === 0) return sendJson(res, 404, { error: 'Alert not found' });
      return sendJson(res, 200, rows[0]);
    }

    const { rows } = await query(
      `UPDATE alerts SET status = 'resolved', resolved_at = now() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (rows.length === 0) return sendJson(res, 404, { error: 'Alert not found' });
    return sendJson(res, 200, rows[0]);
  }

  return methodNotAllowed(res, ['GET', 'PATCH']);
});
