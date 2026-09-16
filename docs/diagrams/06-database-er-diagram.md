# Diagram 06: Database ER Diagram

Transcribed directly from `db/migrations/0001_init.sql`. Narrative
explanation of each table, including the "device status is derived, not
stored" rule and why `predictions` merges two spec concepts, is in
`docs/database/schema.md`.

```mermaid
erDiagram
    ADMINS {
        uuid id PK
        text email UK
        text password_hash
        boolean must_change_password
        timestamptz created_at
        timestamptz last_login_at
    }

    DEVICES {
        uuid id PK
        text device_id UK
        text label
        text device_token_hash
        text firmware_version
        timestamptz registered_at
        timestamptz last_seen_at
        boolean is_active
    }

    SENSOR_READINGS {
        bigserial id PK
        text device_id FK
        double ph "nullable"
        double turbidity_ntu
        double tds_ppm
        bigint device_ts "millis, not epoch"
        timestamptz received_at
        boolean is_valid
        text validation_notes
    }

    MODEL_VERSIONS {
        bigserial id PK
        text model_name
        timestamptz trained_at
        jsonb metrics
        boolean is_active "unique partial index: only one true"
        text notes
    }

    PREDICTIONS {
        bigserial id PK
        bigint reading_id FK "unique: one prediction per reading"
        bigint model_version_id FK
        text water_quality_category "CHECK Safe/Moderate/Unsafe/Critical"
        double prediction_confidence
        jsonb class_probabilities
        boolean contamination_risk
        timestamptz created_at
    }

    ALERTS {
        bigserial id PK
        text device_id FK
        bigint reading_id FK "nullable, SET NULL on delete"
        text severity "CHECK info/warning/critical"
        text reason
        text status "CHECK active/acknowledged/resolved"
        timestamptz created_at
        timestamptz acknowledged_at
        uuid acknowledged_by FK
        timestamptz resolved_at
    }

    SYSTEM_EVENTS {
        bigserial id PK
        text event_type
        text message
        jsonb metadata
        timestamptz created_at
    }

    DEVICES ||--o{ SENSOR_READINGS : "device_id"
    SENSOR_READINGS ||--o| PREDICTIONS : "reading_id (1:1)"
    MODEL_VERSIONS ||--o{ PREDICTIONS : "model_version_id"
    DEVICES ||--o{ ALERTS : "device_id"
    SENSOR_READINGS |o--o{ ALERTS : "reading_id"
    ADMINS ||--o{ ALERTS : "acknowledged_by"
```

Indexes defined in the migration (see `docs/database/schema.md` for why
each exists): `idx_sensor_readings_device_time`, `one_active_model`
(partial unique on `model_versions.is_active`), `one_prediction_per_reading`
(unique on `predictions.reading_id`), `idx_predictions_category`,
`idx_alerts_status`, `idx_system_events_time`.
