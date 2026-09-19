-- Adds a display name to accounts (for the dashboard greeting) and a log
-- of what-if prediction requests (for the per-user dashboard's usage
-- stats - "predictions I've run", their category breakdown, a recent
-- list). See docs/backend/api-contract.md and docs/database/schema.md.
--
-- Design note: `prediction_requests` is deliberately a SEPARATE table from
-- `predictions` (0001_init.sql), not a reuse of it. `predictions` records
-- the ML output for a REAL sensor reading (reading_id is NOT NULL, tied to
-- an actual device). A what-if request from POST /api/predict has no
-- associated reading - it's a hypothetical the user typed in - so giving
-- it a nullable reading_id on the existing table would blur "this is what
-- a real sensor measured" with "this is what a user asked to simulate".
-- Keeping them separate preserves that distinction exactly, matching the
-- project's existing Measured/Generated/Predicted/Simulated terminology
-- discipline (docs/machine-learning/target-methodology.md §1).

ALTER TABLE users ADD COLUMN first_name TEXT;
ALTER TABLE users ADD COLUMN last_name TEXT;

CREATE TABLE prediction_requests (
    id                      BIGSERIAL PRIMARY KEY,
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ph                      DOUBLE PRECISION,
    turbidity_ntu           DOUBLE PRECISION NOT NULL,
    tds_ppm                 DOUBLE PRECISION NOT NULL,
    water_quality_category  TEXT NOT NULL CHECK (water_quality_category IN ('Safe','Moderate','Unsafe','Critical')),
    prediction_confidence   DOUBLE PRECISION NOT NULL,
    class_probabilities     JSONB NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_prediction_requests_user_time ON prediction_requests (user_id, created_at DESC);
