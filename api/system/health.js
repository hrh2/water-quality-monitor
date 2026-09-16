import { query } from '../_lib/db.js';
import { getModelMetadata } from '../_lib/predict.js';
import { deriveDeviceStatus } from '../_lib/devices.js';
import { sendJson, methodNotAllowed, withErrorHandling, requireAdmin } from '../_lib/http.js';

// GET /api/system/health - overview + system status for the admin dashboard.
export default withErrorHandling(async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const auth = requireAdmin(req, res);
  if (!auth) return;

  let dbStatus = 'ok';
  try {
    await query('SELECT 1');
  } catch {
    dbStatus = 'unreachable';
  }

  let modelStatus = 'ok';
  let modelMeta = null;
  try {
    modelMeta = getModelMetadata();
  } catch {
    modelStatus = 'unavailable';
  }

  const { rows: devices } = await query('SELECT last_seen_at FROM devices');
  const deviceCounts = devices.reduce(
    (acc, d) => {
      const status = deriveDeviceStatus(d.last_seen_at);
      acc.total += 1;
      if (status === 'Online') acc.online += 1;
      else acc.offline += 1;
      return acc;
    },
    { total: 0, online: 0, offline: 0 }
  );

  const { rows: readingCountRows } = await query('SELECT count(*) AS count FROM sensor_readings');
  const { rows: categoryRows } = await query(
    `SELECT p.water_quality_category, count(*) AS count
     FROM predictions p GROUP BY p.water_quality_category`
  );
  const { rows: activeAlertRows } = await query(
    "SELECT count(*) AS count FROM alerts WHERE status = 'active'"
  );
  const { rows: recentEvents } = await query(
    'SELECT event_type, message, created_at FROM system_events ORDER BY created_at DESC LIMIT 20'
  );

  return sendJson(res, 200, {
    database: { status: dbStatus },
    ml_model: { status: modelStatus, ...modelMeta },
    devices: deviceCounts,
    total_readings: Number(readingCountRows[0]?.count ?? 0),
    category_distribution: categoryRows,
    active_alerts: Number(activeAlertRows[0]?.count ?? 0),
    recent_system_events: recentEvents,
  });
});
