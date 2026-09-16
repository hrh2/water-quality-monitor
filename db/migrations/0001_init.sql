-- Initial schema for the Smart Water Quality Prediction and Contamination
-- Detection System. See docs/database/schema.md for the ER diagram and a
-- narrative explanation of every table, and docs/architecture/data-contract.md
-- for why sensor column names are exactly ph / turbidity_ntu / tds_ppm.
--
-- Design notes:
--   - `predictions` merges what the spec calls "Prediction" and
--     "WaterQualityAssessment" into one table: both represent the same
--     underlying fact (the ML output for one reading), and a second table
--     would only duplicate it. Documented in docs/database/schema.md.
--   - Timestamps are stored in UTC (timestamptz) and always represent
--     SERVER-side receipt time, never the device's `ts` (which is
--     millis-since-boot, not wall-clock - see the data contract).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE admins (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email               TEXT NOT NULL UNIQUE,
    password_hash       TEXT NOT NULL,
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at       TIMESTAMPTZ
);

CREATE TABLE devices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id           TEXT NOT NULL UNIQUE,       -- matches firmware config.deviceId
    label               TEXT,
    device_token_hash   TEXT NOT NULL,              -- bcrypt hash of the shared device token
    firmware_version    TEXT,
    registered_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ,                -- updated on every accepted reading
    is_active           BOOLEAN NOT NULL DEFAULT TRUE
);

-- Online/offline/never-connected status is DERIVED, not stored, from
-- last_seen_at vs now() (see docs/database/schema.md "Device status rule").
-- No status column exists here on purpose, to avoid it drifting from reality.

CREATE TABLE sensor_readings (
    id              BIGSERIAL PRIMARY KEY,
    device_id       TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    ph              DOUBLE PRECISION,               -- nullable: Modbus read can fail (phOk=false)
    turbidity_ntu   DOUBLE PRECISION NOT NULL,
    tds_ppm         DOUBLE PRECISION NOT NULL,
    device_ts       BIGINT,                         -- device millis() at read time, NOT epoch
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_valid        BOOLEAN NOT NULL DEFAULT TRUE,   -- false = flagged by validation, kept not dropped
    validation_notes TEXT
);

CREATE INDEX idx_sensor_readings_device_time ON sensor_readings (device_id, received_at DESC);

CREATE TABLE model_versions (
    id              BIGSERIAL PRIMARY KEY,
    model_name      TEXT NOT NULL,                  -- e.g. "random_forest"
    trained_at      TIMESTAMPTZ NOT NULL,
    metrics         JSONB NOT NULL,                 -- final_test_metrics from ml/models/model_metadata.json
    is_active       BOOLEAN NOT NULL DEFAULT FALSE,
    notes           TEXT
);

CREATE UNIQUE INDEX one_active_model ON model_versions (is_active) WHERE is_active;

CREATE TABLE predictions (
    id                      BIGSERIAL PRIMARY KEY,
    reading_id              BIGINT NOT NULL REFERENCES sensor_readings(id) ON DELETE CASCADE,
    model_version_id        BIGINT REFERENCES model_versions(id),
    water_quality_category  TEXT NOT NULL CHECK (water_quality_category IN ('Safe','Moderate','Unsafe','Critical')),
    prediction_confidence   DOUBLE PRECISION NOT NULL,
    class_probabilities     JSONB NOT NULL,
    contamination_risk      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX one_prediction_per_reading ON predictions (reading_id);
CREATE INDEX idx_predictions_category ON predictions (water_quality_category, created_at DESC);

CREATE TABLE alerts (
    id              BIGSERIAL PRIMARY KEY,
    device_id       TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    reading_id      BIGINT REFERENCES sensor_readings(id) ON DELETE SET NULL,
    severity        TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
    reason          TEXT NOT NULL,                  -- e.g. "turbidity_ntu 92.3 exceeds critical threshold"
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','acknowledged','resolved')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by  UUID REFERENCES admins(id),
    resolved_at     TIMESTAMPTZ
);

CREATE INDEX idx_alerts_status ON alerts (status, created_at DESC);

CREATE TABLE system_events (
    id          BIGSERIAL PRIMARY KEY,
    event_type  TEXT NOT NULL,   -- e.g. 'device_connected', 'device_offline', 'prediction_failed', 'auth_failed'
    message     TEXT NOT NULL,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_system_events_time ON system_events (created_at DESC);
