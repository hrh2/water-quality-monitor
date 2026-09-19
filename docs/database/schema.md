# Database Schema

Narrative walkthrough of `db/migrations/0001_init.sql` and
`0002_users_and_roles.sql`. See `docs/diagrams/06-database-er-diagram.md`
for the Mermaid ER diagram and `docs/architecture/adr-001-database-choice.md`
for why Postgres + plain SQL migrations were chosen over an ORM.

## Tables

### `users`

One row per account, either role. Migration `0002_users_and_roles.sql`
replaced the original single-role `admins` table with this one, adding a
`role` column (`'admin' | 'user'`) rather than running two parallel auth
systems - login, password hashing, and JWT issuance are identical for both
roles; only authorization (which endpoints a role may call) differs,
enforced in `api/_lib/http.js::requireAuth`. The pre-existing admin
account(s) were migrated in place with `role = 'admin'` so nobody needed
to re-register.

- `first_name`/`last_name` (added in `0003_profile_and_prediction_log.sql`)
  are nullable - required for new registrations (`POST /api/auth/register`)
  but not backfilled for accounts created before this migration (e.g. a
  seeded admin), so the dashboard greeting always has a `null`-safe
  fallback rather than showing a fabricated name.
- `password_hash` is bcrypt (`docs/backend/authentication.md`).
- `must_change_password` defaults to `false`. It's only ever set `true` by
  `scripts/seed_admin.js` (a seeded admin gets a temporary password) - a
  self-registered user chose their own password at signup, so it's never
  forced for them. Cleared by a successful password change either way.
- `is_active` gates login **and every subsequent authenticated request** -
  `requireAuth` re-reads it from the database on every call, not just at
  login, so an admin deactivating a user takes effect on that user's very
  next request rather than only their next login attempt.
- `last_login_at` is updated on every successful `POST /api/auth/login`.
- No "last active admin" lockout guard exists on deactivation - it would
  be unreachable dead code given the self-deactivation guard already makes
  a total-admin-lockout impossible through this API; see
  `api/users/index.js`'s comment.

### `prediction_requests`

Added in `0003_profile_and_prediction_log.sql`. One row per **what-if**
call to `POST /api/predict` (`api/predict.js`), tied to the calling user,
not to any device. Deliberately a **separate table from `predictions`**,
not a reuse of it: `predictions.reading_id` is `NOT NULL` and tied to a
real sensor reading from an actual device, whereas a what-if request is a
hypothetical value a user typed in with no associated reading. Giving it a
nullable `reading_id` on the existing table would blur "this is what a
real sensor measured" with "this is what a user asked to simulate" -
exactly the kind of Measured-vs-Simulated distinction this project is
careful to keep explicit elsewhere (`docs/machine-learning/target-methodology.md` §1).

Powers the per-user Dashboard's usage stats (`GET /api/dashboard` for
`role='user'`): total predictions run, their category breakdown, and a
recent list - always filtered by `user_id`, so one user's dashboard can
never show another user's prediction history.

Index: `idx_prediction_requests_user_time (user_id, created_at DESC)`.

### `devices`

One row per registered ESP8266 device, keyed by the firmware-configured
`device_id` (matches `config.deviceId` in `firmware/firmware.ino`, unique).
`device_token_hash` is the bcrypt hash of a token shown to the admin
**exactly once**, at registration (`POST /api/devices`). `last_seen_at` is
updated on every accepted reading (`api/_lib/ingest.js`). `is_active` lets an
admin deactivate a device without deleting its history (checked in
`authenticateDevice`, returns 403 if false).

**Device status is derived, not stored** - there is deliberately no
`status` column. `api/_lib/devices.js::deriveDeviceStatus(lastSeenAt,
hasWsErrorRecently)` computes one of `Online | Offline | Never connected |
Connection error` from `last_seen_at` at read time:

- `Never connected`: `last_seen_at` is null.
- `Online`: age <= `ONLINE_THRESHOLD_MS` (90,000ms / 90s).
- `Connection error`: older than the threshold **and** a recent
  `device_ws_error` system event exists with no reading since.
- `Offline`: older than the threshold, no such recent error.

**Why 90 seconds**: the firmware reads and publishes every 3 seconds
(`READ_INTERVAL_MS`) and its WebSocket client's reconnect backoff is capped
at 60 seconds (`WIFI_RECONNECT_MAX_INTERVAL_MS`), with buffering meanwhile.
A healthy device should never go this long without either a fresh reading
or a reconnect attempt, so 90 seconds gives roughly one full backoff cycle
of slack before the system calls it offline, rather than flapping between
online/offline on every brief gap. This avoids storing a status that could
silently drift from what's actually true.

### `sensor_readings`

One row per accepted reading. `ph` is nullable (Modbus read failures set it
to null, matching `phOk == false` in the firmware); `turbidity_ntu` and
`tds_ppm` are `NOT NULL` because the ADS1115 channels always produce *a*
voltage even if implausible. `device_ts` stores the device's own `ts`
(`millis()` since boot - **not** an epoch timestamp; see
`docs/architecture/data-contract.md` §2). `received_at` (`timestamptz`,
server clock) is the canonical timestamp used everywhere downstream.
`is_valid`/`validation_notes` record engineering-range flags from
`api/_lib/validation.js` - a reading outside plausible instrument range is
flagged, not dropped, so operators can see exactly what the device sent.

Index: `idx_sensor_readings_device_time (device_id, received_at DESC)` -
supports the very common "latest N readings for a device" query pattern
used by `GET /api/devices/:deviceId`, `GET /api/readings`, and the
contamination module's recent-history lookup.

### `model_versions`

One row per trained/deployed model, `metrics` holding
`final_test_metrics` straight from `ml/models/model_metadata.json`.

Index: `one_active_model` - a **partial unique index** on `is_active` (only
enforced `WHERE is_active`), guaranteeing at most one row can be
`is_active = true` at a time without needing application-level
locking - `scripts/seed_model_version.js` explicitly deactivates the
previous active row in the same transaction before inserting the new one.

### `predictions`

One row per reading that was successfully scored by the ML pipeline (see
below for why this table intentionally merges two originally-separate
spec concepts). `water_quality_category` is constrained by a `CHECK` to
the four documented classes. `class_probabilities` is the full per-class
probability distribution (`JSONB`), while `prediction_confidence` is just
the probability of the predicted class - both are stored so the dashboard
can show either a single confidence number or a full breakdown without a
second query.

Indexes: `one_prediction_per_reading` (unique on `reading_id` - enforces
the 1:1 relationship with `sensor_readings`), `idx_predictions_category
(water_quality_category, created_at DESC)` - supports the class-filtered,
newest-first queries `GET /api/predictions?category=` runs.

**Why `predictions` merges two spec concepts:** an earlier design draft
for this project described a `Prediction` entity (the raw model output)
and a separate `WaterQualityAssessment` entity (the "assessment" combining
prediction with contamination logic) as two tables. In the actual
implementation these represent the same underlying fact - the ML output
for one reading, decorated with the contamination flag that was computed
alongside it in the same `ingestReading()` call - so a second table would
only duplicate the same `reading_id`/`created_at` relationship without
adding new information. This is a deliberate simplification, made once the
real pipeline showed prediction and contamination assessment are always
computed and written together, not an oversight.

### `alerts`

One row per alert raised for a device. `severity` (`info|warning|critical`)
and `status` (`active|acknowledged|resolved`) are `CHECK`-constrained.
`reading_id` is nullable with `ON DELETE SET NULL` (an alert should survive
even if its triggering reading is later removed, e.g. via a device's
`ON DELETE CASCADE`). `acknowledged_by` references the admin who
acknowledged it. Alert creation is deduplicated in application code
(`api/_lib/alerts.js`, 15-minute window per device) rather than at the
schema level.

Index: `idx_alerts_status (status, created_at DESC)` - supports
`GET /api/alerts?status=active` newest-first.

### `system_events`

Free-form operational log: device registrations, auth failures, rejected
readings, unhandled errors, WS connection errors. `metadata` is `JSONB` for
whatever structured context a given event needs (e.g. `{device_id}`,
`{stack, path}`). Consumed by `GET /api/dashboard`'s
`recent_system_events` and by the device `Connection error` status
derivation (`hasWsErrorRecently`).

Index: `idx_system_events_time (created_at DESC)` - the dashboard always
reads the most recent events.

## Timestamps, in general

Every timestamp column is `TIMESTAMPTZ`, stored in UTC, and always
represents **server-side receipt time** - never the device's own `ts`
field, which is `millis()`-since-boot and not comparable across devices or
reboots. This distinction is called out directly in the migration file's
own header comment and in `docs/architecture/data-contract.md` §2.
