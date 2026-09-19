# API Contract

Every HTTP endpoint served under `api/`, as implemented (not aspirational).
Field names match `docs/architecture/data-contract.md` exactly. All
responses are JSON except the two report-download endpoints. Two auth
levels exist:

- **"Any active user"** - a valid, non-expired JWT for a `users` row with
  `is_active = true`, checked **fresh from the database on every request**
  (`api/_lib/http.js::requireUser`) - not just at login, so deactivating an
  account takes effect on its very next request, not the next time it
  would otherwise log in. Returns `401 {"error": "Missing or invalid
  authentication token"}` or `401 {"error": "Account is inactive or no
  longer exists"}`.
- **"Admin required"** - the above, plus `role = 'admin'`
  (`api/_lib/http.js::requireAdmin`). Returns `403 {"error": "Insufficient
  permissions for this action"}` for a valid but non-admin token.

## Auth

All four actions below are dispatched from one consolidated route,
`api/auth/[action].js`, by URL segment - see that file's header comment
for why (Vercel's Hobby-plan function-count limit; also covered in
`docs/deployment/vercel.md`).

### `POST /api/auth/login`

- Auth: none.
- Body: `{ "email": string, "password": string }`
- 200: `{ "token": string, "role": "admin"|"user", "must_change_password": boolean, "first_name": string|null }`
  (`first_name` is `null` for accounts created before names were required,
  e.g. a seeded admin - the dashboard greeting falls back to a
  time-of-day-only greeting in that case, never a fabricated name)
- 400: `{ "error": "email and password are required" }`
- 401: `{ "error": "Invalid email or password" }` (same shape whether the
  account doesn't exist, has the wrong password, or is deactivated - to
  avoid leaking account existence/state - logged as `system_events.auth_failed`
  with the real reason server-side)

Example:
```json
// Request
{ "email": "admin@example.com", "password": "correct-horse-battery" }
// Response 200
{ "token": "eyJhbGciOi...", "role": "admin", "must_change_password": true }
```

### `POST /api/auth/register`

- Auth: none. Public self-registration - always creates `role: 'user'`
  (there is no way to self-register as admin).
- Body: `{ "email": string, "password": string, "first_name": string, "last_name": string }`
  (password >= 10 chars, email must match a basic `x@y.z` pattern,
  first/last name both required non-empty strings - display-only, used to
  greet the user on their Dashboard, never used for authentication)
- 201: `{ "token": string, "role": "user", "must_change_password": false, "first_name": string }`
  (self-registered users choose their own password, so unlike a seeded
  admin account there is no forced change)
- 400: invalid email, password too short, or missing first/last name
- 409: `{ "error": "An account with this email already exists" }`

### `POST /api/auth/change-password`

- Auth: any active user (changes your own password, either role).
- Body: `{ "current_password": string, "new_password": string }` (new
  password must be >= 10 characters)
- 200: `{ "ok": true }`
- 400: missing fields or password too short
- 401: `{ "error": "current_password is incorrect" }`

### `GET /api/auth/me`

- Auth: any active user.
- 200: `{ "id", "email", "role", "must_change_password", "first_name", "last_name" }`
- 401: token invalid or account inactive/deleted

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

- Auth: **any active user** (admin or self-registered) - running a
  what-if prediction is one of the two capabilities open to regular users.
- Body: `{ "ph"?: number|null, "turbidity_ntu": number, "tds_ppm": number }` - an ad-hoc what-if query, not tied to any real sensor reading or device. It **does not create any `sensor_readings`/`predictions` rows**, but the request itself is logged to `prediction_requests` (device-free, user-scoped) to power the caller's personal Dashboard stats - see `docs/database/schema.md`. Used by the ML dashboard tab to explore the model and by tests to verify JS/Python parity.
- 200: `{ water_quality_category, prediction_confidence, class_probabilities, model: { model_type, class_labels, feature_order } }`
- 400: `turbidity_ntu`/`tds_ppm` missing or not numbers

### `GET /api/predictions?category=&device_id=&limit=`

- Auth: **any active user** - not per-user-scoped data, so no reason to
  restrict it to admins once regular users can also make predictions.
- Query params optional; `limit` capped at 500 (default 100).
- 200: `{ predictions: [{ id, water_quality_category, prediction_confidence, class_probabilities, contamination_risk, created_at, device_id, ph, turbidity_ntu, tds_ppm }], class_distribution: [{ water_quality_category, count }] }`

## Users (admin-only)

### `GET /api/users`

- Auth: admin required.
- 200: `{ users: [{ id, email, role, is_active, must_change_password, created_at, last_login_at }] }`

### `PATCH /api/users`

- Auth: admin required.
- Body: `{ "id": uuid, "action": "activate" | "deactivate" }`
- 200: `{ id, email, role, is_active }`
- 400: `{ "error": "You cannot deactivate your own account" }` (the only
  guard needed against a lockout - see `api/users/index.js`'s comment for
  why a separate "last active admin" count check was considered and
  dropped as unreachable dead code)
- 404: `{ "error": "User not found" }`

## Reports (any active user)

### `GET /api/reports/:type?format=csv|pdf&device_id=&from=&to=`

- Auth: **any active user** - exporting a report is a read of
  already-visible operational data, not a privileged action (unlike
  device/alert/user *management*, which stays admin-only above).
- `type`: `readings` | `predictions` | `alerts` | `devices`. `devices`
  ignores `device_id`/`from`/`to` (see `api/_lib/reports.js`).
- `format` defaults to `csv`. Response is the raw file, not JSON:
  `Content-Type: text/csv; charset=utf-8` or `application/pdf`, with
  `Content-Disposition: attachment; filename="..."`. Capped at 5000 rows.
- Every export is logged to `system_events` (`event_type: 'report_exported'`)
  with the requesting user, type, format, filters, and row count.
- 400: unknown `type` or `format`
- 401: not authenticated / inactive

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

## Dashboard (role-aware)

### `GET /api/dashboard`

- Auth: any active user. Response shape depends entirely on the caller's
  role - this is the same endpoint that powers both the admin's Dashboard
  tab (and the System tab, which reads a subset of the admin shape) and a
  regular user's Dashboard tab. Formerly `GET /api/system/health`
  (admin-only); renamed and made role-aware when per-user dashboards were
  added - see `docs/deployment/vercel.md` for why this reuses one file
  instead of adding a second.
- **200 (role='admin')**, cross-platform, unchanged from the old
  `/api/system/health` shape plus three new all-time usage counters:
```json
{
  "database": { "status": "ok" | "unreachable" },
  "ml_model": { "status": "ok" | "unavailable", "model_type": "...", "class_labels": [...], "feature_order": [...] },
  "devices": { "total": 0, "online": 0, "offline": 0 },
  "total_readings": 0,
  "category_distribution": [{ "water_quality_category": "Safe", "count": "0" }],
  "active_alerts": 0,
  "recent_system_events": [{ "event_type", "message", "created_at" }],
  "total_users": 0,
  "total_prediction_requests": 0,
  "total_reports_exported": 0
}
```
- **200 (role='user')**, scoped to only the caller's own activity - never
  another user's data:
```json
{
  "first_name": "Ada",
  "last_name": "Lovelace",
  "account": { "created_at": "...", "last_login_at": "..." },
  "predictions": {
    "total": 3,
    "by_category": [{ "water_quality_category": "Safe", "count": "2" }],
    "recent": [{ "water_quality_category": "Safe", "prediction_confidence": 0.97, "ph": 7.1, "turbidity_ntu": 2, "tds_ppm": 200, "created_at": "..." }]
  },
  "reports_exported": {
    "total": 1,
    "by_type": [{ "type": "readings", "count": "1" }]
  }
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
