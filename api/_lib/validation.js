// Sensor reading validation.
//
// These are ENGINEERING sanity ranges (what is physically/instrumentally
// plausible for these sensors), not health/potability limits - see
// docs/machine-learning/target-methodology.md for the health-oriented
// thresholds used only for category assignment. An out-of-range reading is
// FLAGGED (is_valid = false, stored with validation_notes) rather than
// silently coerced or dropped, so operators can see what the device sent.

const PH_MIN = 0;
const PH_MAX = 14;
const TURBIDITY_MIN = 0;
const TURBIDITY_MAX = 3000; // ADS1115 calibration curve saturates well below this
const TDS_MIN = 0;
const TDS_MAX = 50000; // sane upper bound for a TDS probe in freshwater contexts

/**
 * @param {{device_id?: string, token?: string, ts?: number, ph?: number|null, turbidity_ntu?: number, tds_ppm?: number}} payload
 * @returns {{ok: boolean, errors: string[], notes: string[]}}
 */
export function validateReadingPayload(payload) {
  const errors = [];
  const notes = [];

  if (!payload || typeof payload !== 'object') {
    return { ok: false, errors: ['payload must be a JSON object'], notes };
  }
  if (typeof payload.device_id !== 'string' || payload.device_id.length === 0) {
    errors.push('device_id is required and must be a non-empty string');
  }
  if (typeof payload.token !== 'string' || payload.token.length === 0) {
    errors.push('token is required and must be a non-empty string');
  }
  if (typeof payload.turbidity_ntu !== 'number' || Number.isNaN(payload.turbidity_ntu)) {
    errors.push('turbidity_ntu is required and must be a number');
  } else if (payload.turbidity_ntu < TURBIDITY_MIN || payload.turbidity_ntu > TURBIDITY_MAX) {
    notes.push(`turbidity_ntu ${payload.turbidity_ntu} outside plausible range [${TURBIDITY_MIN}, ${TURBIDITY_MAX}]`);
  }
  if (typeof payload.tds_ppm !== 'number' || Number.isNaN(payload.tds_ppm)) {
    errors.push('tds_ppm is required and must be a number');
  } else if (payload.tds_ppm < TDS_MIN || payload.tds_ppm > TDS_MAX) {
    notes.push(`tds_ppm ${payload.tds_ppm} outside plausible range [${TDS_MIN}, ${TDS_MAX}]`);
  }

  // ph is nullable (Modbus read failure) but if present must be numeric & in range.
  if (payload.ph !== null && payload.ph !== undefined) {
    if (typeof payload.ph !== 'number' || Number.isNaN(payload.ph)) {
      errors.push('ph, when present, must be a number or null');
    } else if (payload.ph < PH_MIN || payload.ph > PH_MAX) {
      notes.push(`ph ${payload.ph} outside physically meaningful range [${PH_MIN}, ${PH_MAX}]`);
    }
  }

  return { ok: errors.length === 0, errors, notes };
}
