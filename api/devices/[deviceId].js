import { query } from '../_lib/db.js';
import { deriveDeviceStatus } from '../_lib/devices.js';
import { sendJson, methodNotAllowed, withErrorHandling, requireAdmin } from '../_lib/http.js';

// GET /api/devices/:deviceId - device detail + recent readings/predictions
export default withErrorHandling(async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const auth = requireAdmin(req, res);
  if (!auth) return;

  const { deviceId } = req.query;

  const { rows: deviceRows } = await query('SELECT * FROM devices WHERE device_id = $1', [deviceId]);
  if (deviceRows.length === 0) return sendJson(res, 404, { error: `Device ${deviceId} not found` });
  const device = deviceRows[0];

  const { rows: readings } = await query(
    `SELECT r.id, r.ph, r.turbidity_ntu, r.tds_ppm, r.received_at, r.is_valid,
            p.water_quality_category, p.prediction_confidence, p.contamination_risk
     FROM sensor_readings r
     LEFT JOIN predictions p ON p.reading_id = r.id
     WHERE r.device_id = $1
     ORDER BY r.received_at DESC
     LIMIT 200`,
    [deviceId]
  );

  return sendJson(res, 200, {
    device_id: device.device_id,
    label: device.label,
    firmware_version: device.firmware_version,
    registered_at: device.registered_at,
    last_seen_at: device.last_seen_at,
    is_active: device.is_active,
    status: deriveDeviceStatus(device.last_seen_at),
    readings,
  });
});
