// Device online/offline status derivation (section 8 of the project spec).
// Status is never stored - it is always computed from `last_seen_at` at
// read time, so it can't drift out of sync with reality.

// The firmware reads every 3s (READ_INTERVAL_MS) and the WebSocket client
// reconnects with backoff capped at 60s, buffering readings meanwhile - so
// a healthy device should never go this long without either a reading or a
// reconnect. 90s gives one full backoff cycle of slack before we call it
// offline.
export const ONLINE_THRESHOLD_MS = 90_000;

/**
 * @param {string|null} lastSeenAt - ISO timestamp string or null
 * @param {boolean} hasWsErrorRecently - true if a device_ws_error system_event
 *   exists for this device within ONLINE_THRESHOLD_MS and no reading followed it
 * @returns {'Online'|'Offline'|'Never connected'|'Connection error'}
 */
export function deriveDeviceStatus(lastSeenAt, hasWsErrorRecently = false) {
  if (!lastSeenAt) return 'Never connected';

  const ageMs = Date.now() - new Date(lastSeenAt).getTime();
  if (ageMs <= ONLINE_THRESHOLD_MS) return 'Online';
  if (hasWsErrorRecently) return 'Connection error';
  return 'Offline';
}
