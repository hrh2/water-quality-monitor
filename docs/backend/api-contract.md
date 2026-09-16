# API Contract

Every HTTP endpoint served under `api/`, as implemented (not aspirational).
Field names match `docs/architecture/data-contract.md` exactly. All
responses are JSON. All admin-only routes require `Authorization: Bearer
<jwt>` and return `401 {"error": "Missing or invalid authentication token"}`
if it's missing/invalid/expired (`api/_lib/http.js::requireAdmin`).

## Auth

### `POST /api/auth/login`

- Auth: none.
- Body: `{ "email": string, "password": string }`
- 200: `{ "token": string, "must_change_password": boolean }`
- 400: `{ "error": "email and password are required" }`
- 401: `{ "error": "Invalid email or password" }` (same shape whether the
  email exists or not, and logged as `system_events.auth_failed`)

Example:
```json
// Request
{ "email": "admin@example.com", "password": "correct-horse-battery" }
// Response 200
{ "token": "eyJhbGciOi...", "must_change_password": true }
```

### `POST /api/auth/change-password`

- Auth: admin required.
- Body: `{ "current_password": string, "new_password": string }` (new
  password must be >= 10 characters)
- 200: `{ "ok": true }`
- 400: missing fields or password too short
- 401: `{ "error": "current_password is incorrect" }`

### `GET /api/auth/me`

- Auth: admin required.
- 200: `{ "id", "email", "must_change_password", "created_at", "last_login_at" }`
- 401: token invalid, or `{ "error": "Admin account no longer exists" }` if the row was deleted after the token was issued

## Devices

### `GET /api/devices`

- Auth: admin required.
- 200: `{ "devices": [{ device_id, label, firmware_version, registered_at, last_seen_at, is_active, reading_count, status }] }`
  where `status` is one of `Online | Offline | Never connected | Connection error` (`api/_lib/devices.js::deriveDeviceStatus`, threshold 90s).

### `POST /api/devices`

- Auth: admin required.
- Body: `{ "device_id": string, "label"?: string, "firmware_version"?: string }`
- 201: `{ "device_id", "device_token": "<plaintext, shown once>", "warning": "Store this token now - it cannot be retrieved again. Only its hash is kept." }`
- 400: `device_id` missing
- 409: `{ "error": "Device <id> is already registered" }`

Example:
```json
// Request
{ "device_id": "soil-water-monitor-1", "label": "Tank A" }
// Response 201
{
  "device_id": "soil-water-monitor-1",
  "device_token": "6f1c...e2",
  "warning": "Store this token now - it cannot be retrieved again. Only its hash is kept."
}
```

### `GET /api/devices/:deviceId`

- Auth: admin required.
- 200: device detail + `status` + up to 200 most recent readings joined with their prediction (`ph, turbidity_ntu, tds_ppm, received_at, is_valid, water_quality_category, prediction_confidence, contamination_risk`)
- 404: `{ "error": "Device <id> not found" }`

## Readings

### `GET /api/readings?device_id=&from=&to=&limit=`

- Auth: admin required.
- Query params all optional; `limit` capped at 1000 (default 200).
- 200: `{ "readings": [{ id, device_id, ph, turbidity_ntu, tds_ppm, received_at, is_valid, water_quality_category, prediction_confidence, contamination_risk }] }`

### `POST /api/readings`

- Auth: **device token**, not admin JWT - `{ device_id, token }` in the body, verified against the device's bcrypt hash. This is the manual/testing ingestion path; the firmware's real path is the WebSocket relay in `api/ws.js`. Both call the identical `api/_lib/ingest.js::ingestReading`.
- Body: `{ "device_id": string, "token": string, "ts"?: number, "ph"?: number|null, "turbidity_ntu": number, "tds_ppm": number }`
- 201: the enriched reading - `{ device_id, ts, received_at, ph, turbidity_ntu, tds_ppm, is_valid, water_quality_category, prediction_confidence, contamination_risk, alert }`
- 400: invalid payload (`IngestError`, message lists every validation error)
- 401: invalid device token
- 403: device deactivated (`is_active = false`)
- 404: unknown `device_id`

Example:
```json
// Request
{ "device_id": "soil-water-monitor-1", "token": "6f1c...e2", "ts": 1583421, "ph": 7.12, "turbidity_ntu": 3.4, "tds_ppm": 214.6 }
// Response 201
{
  "device_id": "soil-water-monitor-1", "ts": 1583421, "received_at": "2026-09-15T21:10:00.000Z",
  "ph": 7.12, "turbidity_ntu": 3.4, "tds_ppm": 214.6, "is_valid": true,
  "water_quality_category": "Safe", "prediction_confidence": 0.87,
  "contamination_risk": false, "alert": null
}
```

## Prediction

### `POST /api/predict`

- Auth: admin required.
- Body: `{ "ph"?: number|null, "turbidity_ntu": number, "tds_ppm": number }` - **ad-hoc, does not persist anything.** Used by the ML dashboard tab to explore the model and by tests to verify JS/Python parity.
- 200: `{ water_quality_category, prediction_confidence, class_probabilities, model: { model_type, class_labels, feature_order } }`
- 400: `turbidity_ntu`/`tds_ppm` missing or not numbers

### `GET /api/predictions?category=&device_id=&limit=`

- Auth: admin required.
- Query params optional; `limit` capped at 500 (default 100).
- 200: `{ predictions: [{ id, water_quality_category, prediction_confidence, class_probabilities, contamination_risk, created_at, device_id, ph, turbidity_ntu, tds_ppm }], class_distribution: [{ water_quality_category, count }] }`

## Alerts

### `GET /api/alerts?status=active`

- Auth: admin required.
- 200: `{ alerts: [{ id, device_id, reading_id, severity, reason, status, created_at, acknowledged_at, acknowledged_by, resolved_at }] }` (up to 200, newest first)

### `PATCH /api/alerts`

- Auth: admin required.
- Body: `{ "id": number, "action": "acknowledge" | "resolve" }`
- 200: the updated alert row
- 400: missing/invalid `id`/`action`
- 404: `{ "error": "Alert not found" }`

`acknowledge` sets `status='acknowledged'`, `acknowledged_at=now()`,
`acknowledged_by=<admin id from JWT>`. `resolve` sets
`status='resolved'`, `resolved_at=now()`.

## System

### `GET /api/system/health`

- Auth: admin required.
- 200:
```json
{
  "database": { "status": "ok" | "unreachable" },
  "ml_model": { "status": "ok" | "unavailable", "model_type": "...", "class_labels": [...], "feature_order": [...] },
  "devices": { "total": 0, "online": 0, "offline": 0 },
  "total_readings": 0,
  "category_distribution": [{ "water_quality_category": "Safe", "count": "0" }],
  "active_alerts": 0,
  "recent_system_events": [{ "event_type", "message", "created_at" }]
}
```

## WebSocket: `api/ws.js` (path `/api/ws`)

Not a REST endpoint - a persistent connection. Two message shapes handled:

- **Device -> server** (identified by presence of `token`): the same
  payload shape as `POST /api/readings`'s body. Response is not a
  reply on the same connection to the device; instead the enriched
  reading is broadcast to all subscribed dashboard viewers.
- **Dashboard viewer -> server**: `{"type": "subscribe"}` registers the
  connection as a viewer; it immediately receives the last known enriched
  reading if one exists, then every subsequent broadcast.

Malformed JSON on either side is silently ignored (not an error response -
there is no response channel back to a raw WS message sender other than
broadcast). See `docs/diagrams/02-iot-communication-architecture.md` and
`docs/diagrams/04-data-pipeline.md`.

## Error shape (all routes)

Unhandled exceptions are caught by `withErrorHandling`
(`api/_lib/http.js`) and returned as `500 {"error": "Internal server
error"}` with no stack trace exposed; the real error is logged to
`system_events` (`event_type: 'unhandled_error'`). See
`docs/backend/error-handling.md`.
