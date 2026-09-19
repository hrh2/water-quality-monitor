# Diagram 03: Software Architecture

A component-level view of the backend's real module boundaries, grouped by
concern: ingestion, authentication, ML inference, and data access. Every
box below is a real file in `api/`.

```mermaid
flowchart TB
    subgraph Entry Points
        WSJS[api/ws.js\nWebSocket relay]
        READINGS[api/readings.js\nGET/POST]
        DEVICES[api/devices/index.js\napi/devices/[deviceId].js]
        AUTHR[api/auth/login.js\napi/auth/change-password.js\napi/auth/me.js]
        PREDICT_R[api/predict.js]
        PREDICTIONS_R[api/predictions.js]
        ALERTS_R[api/alerts.js]
        HEALTH[api/dashboard.js]
    end

    subgraph Shared Library api/_lib/
        HTTP[http.js\nsendJson, requireAdmin,\nwithErrorHandling]
        AUTHLIB[auth.js\nbcrypt + JWT]
        VALID[validation.js]
        ING[ingest.js\ningestReading pipeline]
        PREDICTLIB[predict.js\nportable model evaluator]
        CONTAM[contamination.js]
        DEVICESLIB[devices.js\nderiveDeviceStatus]
        ALERTSLIB[alerts.js\ncreateAlertsIfNeeded]
        DB[db.js\npg.Pool]
    end

    WSJS --> ING
    READINGS --> ING
    ING --> VALID
    ING --> AUTHLIB
    ING --> PREDICTLIB
    ING --> CONTAM
    ING --> ALERTSLIB
    ING --> DB

    DEVICES --> DEVICESLIB
    DEVICES --> AUTHLIB
    DEVICES --> DB
    AUTHR --> AUTHLIB
    AUTHR --> DB
    PREDICT_R --> PREDICTLIB
    PREDICTIONS_R --> DB
    ALERTS_R --> DB
    HEALTH --> DEVICESLIB
    HEALTH --> PREDICTLIB
    HEALTH --> DB

    DEVICES -.uses.-> HTTP
    AUTHR -.uses.-> HTTP
    PREDICT_R -.uses.-> HTTP
    PREDICTIONS_R -.uses.-> HTTP
    ALERTS_R -.uses.-> HTTP
    HEALTH -.uses.-> HTTP
    READINGS -.uses.-> HTTP

    PREDICTLIB -.reads.-> MODELJSON[[ml/models/portable_model.json]]
    DB --> PG[(PostgreSQL)]
```

Design notes visible in this diagram:

- `api/_lib/ingest.js` is the single pipeline both `api/ws.js` (device's
  real path) and `api/readings.js` (`POST`, manual/testing path) call, so
  the two ingestion entry points cannot diverge in behavior.
- `api/_lib/http.js::withErrorHandling` wraps every REST handler so
  unexpected errors become a generic 500 response and are logged to
  `system_events` rather than leaked to the client
  (`docs/backend/error-handling.md`).
- The ML inference module (`api/_lib/predict.js`) has no dependency on any
  other `api/_lib/*` module except reading the portable JSON file - it is
  intentionally standalone, matching
  `docs/architecture/adr-002-ml-inference-runtime.md`.
