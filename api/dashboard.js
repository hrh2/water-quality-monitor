import { query } from './_lib/db.js';
import { getModelMetadata } from './_lib/predict.js';
import { deriveDeviceStatus } from './_lib/devices.js';
import { sendJson, methodNotAllowed, withErrorHandling, requireUser } from './_lib/http.js';

// GET /api/dashboard - role-aware. Formerly GET /api/system/health
// (admin-only); renamed and opened to any active user when per-user
// dashboards were added, since the two payloads below share most of their
// plumbing (device/model status lookups) and keeping them in one file
// avoids a second Vercel function (see docs/deployment/vercel.md's
// function-count accounting). The admin-only "System" tab
// (`public/js/sections/system.js`) also calls this endpoint and simply
// reads a subset of the admin payload - nothing there changed.
//
// - role='admin': cross-platform system status (unchanged shape from the
//   old /api/system/health, plus three new all-time usage counters).
// - role='user': stats scoped to that caller alone - their own what-if
//   prediction history and report-export count. Never includes another
//   user's data.
export default withErrorHandling(async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const auth = await requireUser(req, res);
  if (!auth) return;

  if (auth.role === 'admin') {
    return sendJson(res, 200, await buildAdminDashboard());
  }
  return sendJson(res, 200, await buildUserDashboard(auth));
});

async function buildAdminDashboard() {
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

  // Cross-platform "system usage" counters - new for the renamed Dashboard
  // tab, not part of the old System tab payload, but harmless to include
  // there too since it's the same admin-only response.
  const { rows: userCountRows } = await query('SELECT count(*) AS count FROM users');
  const { rows: predictionRequestRows } = await query('SELECT count(*) AS count FROM prediction_requests');
  const { rows: reportExportRows } = await query(
    "SELECT count(*) AS count FROM system_events WHERE event_type = 'report_exported'"
  );

  return {
    database: { status: dbStatus },
    ml_model: { status: modelStatus, ...modelMeta },
    devices: deviceCounts,
    total_readings: Number(readingCountRows[0]?.count ?? 0),
    category_distribution: categoryRows,
    active_alerts: Number(activeAlertRows[0]?.count ?? 0),
    recent_system_events: recentEvents,
    total_users: Number(userCountRows[0]?.count ?? 0),
    total_prediction_requests: Number(predictionRequestRows[0]?.count ?? 0),
    total_reports_exported: Number(reportExportRows[0]?.count ?? 0),
  };
}

async function buildUserDashboard(auth) {
  const { rows: totalRows } = await query(
    'SELECT count(*) AS count FROM prediction_requests WHERE user_id = $1',
    [auth.id]
  );
  const { rows: categoryRows } = await query(
    `SELECT water_quality_category, count(*) AS count
     FROM prediction_requests WHERE user_id = $1 GROUP BY water_quality_category`,
    [auth.id]
  );
  const { rows: recentRows } = await query(
    `SELECT water_quality_category, prediction_confidence, ph, turbidity_ntu, tds_ppm, created_at
     FROM prediction_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
    [auth.id]
  );
  const { rows: reportRows } = await query(
    `SELECT metadata->>'type' AS type, count(*) AS count
     FROM system_events
     WHERE event_type = 'report_exported' AND metadata->>'user_id' = $1
     GROUP BY metadata->>'type'`,
    [auth.id]
  );
  const { rows: reportTotalRows } = await query(
    `SELECT count(*) AS count FROM system_events
     WHERE event_type = 'report_exported' AND metadata->>'user_id' = $1`,
    [auth.id]
  );

  return {
    first_name: auth.first_name,
    last_name: auth.last_name,
    account: { created_at: auth.created_at, last_login_at: auth.last_login_at },
    predictions: {
      total: Number(totalRows[0]?.count ?? 0),
      by_category: categoryRows,
      recent: recentRows,
    },
    reports_exported: {
      total: Number(reportTotalRows[0]?.count ?? 0),
      by_type: reportRows,
    },
  };
}
