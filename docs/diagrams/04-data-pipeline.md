# Diagram 04: Data Pipeline

The real data flow inside `api/_lib/ingest.js::ingestReading`, from a raw
wire message to a broadcast/HTTP response. This is the single pipeline
shared by both the WebSocket path (`api/ws.js`) and the HTTP fallback path
(`POST /api/readings`).

```mermaid
flowchart TD
    A[Raw JSON message\ndevice_id, token, ts, ph, turbidity_ntu, tds_ppm] --> B[validateReadingPayload\napi/_lib/validation.js]
    B -->|errors| REJECT1[IngestError 400\nreading rejected, not stored]
    B -->|ok, notes may be non-empty| C[authenticateDevice\napi/_lib/ingest.js]
    C -->|unknown device| REJECT2[IngestError 404]
    C -->|inactive device| REJECT3[IngestError 403]
    C -->|bad token| REJECT4[IngestError 401]
    C -->|ok| D[INSERT sensor_readings\nis_valid = notes.length == 0]
    D --> E[UPDATE devices.last_seen_at]
    E --> F[predictWaterQuality\napi/_lib/predict.js]
    F --> G[assessContaminationRisk\napi/_lib/contamination.js\nrule + statistical z-score vs last 30 readings]
    G --> H[INSERT predictions\nwater_quality_category, prediction_confidence,\nclass_probabilities, contamination_risk]
    H --> I[createAlertsIfNeeded\napi/_lib/alerts.js\nseverity from category + contamination,\n15-min dedup window]
    I --> J[Enriched result returned]
    J --> K[api/ws.js: broadcast to viewers]
    J --> L[api/readings.js: HTTP 201 response]
```

Notes tying this to the real schema and rules:

- A reading with out-of-range-but-well-typed values (e.g. `ph: 20`) is
  **flagged, not rejected**: `is_valid = false` with `validation_notes`
  set, but it is still stored and still predicted on -
  `api/_lib/validation.js` distinguishes structural errors (rejected) from
  implausible-but-parseable values (flagged).
- Contamination assessment combines three independent signals: hard
  thresholds (`turbidity_ntu > 50`, `tds_ppm > 2000`, `ph` outside
  `[5.5, 9.5]`), a z-score check against the same device's last 30
  readings (needs at least 10 for a meaningful mean/std), and the
  predicted category itself (`Critical`/`Unsafe` alone triggers it). See
  `docs/machine-learning/contamination-detection.md`.
- Alerts are deduplicated per device: no new `alerts` row is created if an
  active one already exists for that device within the last 15 minutes.
