// Shared reading-ingestion pipeline used by both the WebSocket relay
// (api/ws.js, the firmware's real path) and the HTTP POST /api/readings
// endpoint (manual/testing path). Single implementation so the two paths
// can never drift apart.
//
// Pipeline: validate -> authenticate device -> persist reading -> predict
// -> assess contamination -> create alert if needed -> update device
// last_seen_at -> return the enriched result for broadcast/response.
import { verifyPassword } from './auth.js';
import { assessContaminationRisk } from './contamination.js';
import { query } from './db.js';
import { validateReadingPayload } from './validation.js';
import { predictWaterQuality } from './predict.js';
import { createAlertsIfNeeded } from './alerts.js';

export class IngestError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function authenticateDevice(deviceId, token) {
  const { rows } = await query(
    'SELECT device_id, device_token_hash, is_active FROM devices WHERE device_id = $1',
    [deviceId]
  );
  if (rows.length === 0) {
    throw new IngestError(404, `Unknown device_id: ${deviceId}. Register it first via POST /api/devices.`);
  }
  const device = rows[0];
  if (!device.is_active) {
    throw new IngestError(403, `Device ${deviceId} is deactivated.`);
  }
  const valid = await verifyPassword(token, device.device_token_hash);
  if (!valid) {
    throw new IngestError(401, 'Invalid device token.');
  }
}

export async function ingestReading(payload) {
  const { ok, errors, notes } = validateReadingPayload(payload);
  if (!ok) {
    throw new IngestError(400, `Invalid reading payload: ${errors.join('; ')}`);
  }

  await authenticateDevice(payload.device_id, payload.token);

  const isValid = notes.length === 0;
  const { rows: readingRows } = await query(
    `INSERT INTO sensor_readings (device_id, ph, turbidity_ntu, tds_ppm, device_ts, is_valid, validation_notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, device_id, ph, turbidity_ntu, tds_ppm, device_ts, received_at, is_valid`,
    [
      payload.device_id,
      payload.ph ?? null,
      payload.turbidity_ntu,
      payload.tds_ppm,
      payload.ts ?? null,
      isValid,
      notes.length > 0 ? notes.join('; ') : null,
    ]
  );
  const reading = readingRows[0];

  await query('UPDATE devices SET last_seen_at = now() WHERE device_id = $1', [payload.device_id]);

  const prediction = predictWaterQuality({
    ph: payload.ph ?? null,
    turbidity_ntu: payload.turbidity_ntu,
    tds_ppm: payload.tds_ppm,
  });

  const { rows: recentRows } = await query(
    `SELECT turbidity_ntu, tds_ppm FROM sensor_readings
     WHERE device_id = $1 ORDER BY received_at DESC LIMIT 30`,
    [payload.device_id]
  );
  const contamination = assessContaminationRisk(payload, prediction.water_quality_category, recentRows);

  const { rows: activeModel } = await query(
    'SELECT id FROM model_versions WHERE is_active LIMIT 1'
  );
  const modelVersionId = activeModel[0]?.id ?? null;

  await query(
    `INSERT INTO predictions (reading_id, model_version_id, water_quality_category, prediction_confidence, class_probabilities, contamination_risk)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      reading.id,
      modelVersionId,
      prediction.water_quality_category,
      prediction.prediction_confidence,
      JSON.stringify(prediction.class_probabilities),
      contamination.contamination_risk,
    ]
  );

  const alert = await createAlertsIfNeeded({
    deviceId: payload.device_id,
    readingId: reading.id,
    category: prediction.water_quality_category,
    contamination,
  });

  return {
    device_id: reading.device_id,
    ts: reading.device_ts,
    received_at: reading.received_at,
    ph: reading.ph,
    turbidity_ntu: reading.turbidity_ntu,
    tds_ppm: reading.tds_ppm,
    is_valid: reading.is_valid,
    water_quality_category: prediction.water_quality_category,
    prediction_confidence: prediction.prediction_confidence,
    contamination_risk: contamination.contamination_risk,
    alert,
  };
}
