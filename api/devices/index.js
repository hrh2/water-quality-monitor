import crypto from 'crypto';
import { query } from '../_lib/db.js';
import { hashPassword } from '../_lib/auth.js';
import { deriveDeviceStatus } from '../_lib/devices.js';
import { sendJson, methodNotAllowed, withErrorHandling, requireAdmin, readJsonBody } from '../_lib/http.js';

// GET  /api/devices          - list all devices with derived status
// POST /api/devices          - register a new device, returns the plaintext
//                               token ONCE (only the bcrypt hash is stored)
export default withErrorHandling(async function handler(req, res) {
  const auth = requireAdmin(req, res);
  if (!auth) return;

  if (req.method === 'GET') {
    const { rows } = await query(
      `SELECT d.device_id, d.label, d.firmware_version, d.registered_at, d.last_seen_at, d.is_active,
              (SELECT count(*) FROM sensor_readings r WHERE r.device_id = d.device_id) AS reading_count
       FROM devices d ORDER BY d.registered_at DESC`
    );
    const devices = rows.map((d) => ({ ...d, status: deriveDeviceStatus(d.last_seen_at) }));
    return sendJson(res, 200, { devices });
  }

  if (req.method === 'POST') {
    const { device_id, label, firmware_version } = await readJsonBody(req);
    if (typeof device_id !== 'string' || device_id.length === 0) {
      return sendJson(res, 400, { error: 'device_id is required' });
    }

    const { rows: existing } = await query('SELECT 1 FROM devices WHERE device_id = $1', [device_id]);
    if (existing.length > 0) {
      return sendJson(res, 409, { error: `Device ${device_id} is already registered` });
    }

    const plaintextToken = crypto.randomBytes(24).toString('hex');
    const tokenHash = await hashPassword(plaintextToken);

    await query(
      `INSERT INTO devices (device_id, label, device_token_hash, firmware_version)
       VALUES ($1, $2, $3, $4)`,
      [device_id, label ?? null, tokenHash, firmware_version ?? null]
    );

    await query(
      'INSERT INTO system_events (event_type, message, metadata) VALUES ($1, $2, $3)',
      ['device_registered', `Device ${device_id} registered`, JSON.stringify({ device_id })]
    );

    // The plaintext token is only ever visible in this one response - flash
    // it into the firmware's config (WiFiManager portal / serial `set`
    // command / remote set_config) and it is never retrievable again.
    return sendJson(res, 201, {
      device_id,
      device_token: plaintextToken,
      warning: 'Store this token now - it cannot be retrieved again. Only its hash is kept.',
    });
  }

  return methodNotAllowed(res, ['GET', 'POST']);
});
