# Smart Water Quality Prediction and Contamination Detection System

An IoT + machine-learning system that reads real sensor data from an
ESP8266-based water-quality probe, predicts a water-quality category with
a trained classifier, flags potential contamination risk, and surfaces all
of it through a real-time public readout and a full admin dashboard.

This README is the entry point. Full technical detail - architecture,
diagrams, API contract, database schema, ML methodology, limitations, and
book/thesis-ready material - lives under [`docs/`](docs/); this file links
out to it rather than duplicating it.

## 1. What this is

Three real sensors (pH, turbidity, total dissolved solids) feed a
Random-Forest classifier that predicts one of four water-quality
categories (`Safe`, `Moderate`, `Unsafe`, `Critical`) and raises alerts on
predicted or statistically anomalous contamination risk. It does **not**
certify drinking-water potability - see
[`docs/limitations/ml-limitations.md`](docs/limitations/ml-limitations.md)
for exactly what it does and doesn't claim, and why.

## 2. Problem being solved

Manual water-quality testing is slow and labor-intensive. This project
demonstrates a low-cost, real-time alternative: continuous IoT sensing,
automated ML-based classification, and immediate operator alerting,
instead of periodic manual sampling. See
[`docs/book-material/02-problem-definition.md`](docs/book-material/02-problem-definition.md).

## 3. Features

- Real-time sensor readout (public, `index.html`) and a full console (`admin.html`) shared by both roles
- JWT + bcrypt authentication, two roles (`admin`/`user`), public self-registration (name required), forced first-login password change for seeded admins
- Role-scoped Dashboard tab with a name-based greeting: admins see cross-platform stats (all devices, all users, all-time usage), regular users see only their own prediction/report activity - enforced server-side, not just hidden client-side
- Admin user management: list, activate/deactivate any account (self-deactivation blocked)
- Report export (CSV/PDF) for readings, predictions, alerts, and a device summary - open to any active user, admin or self-registered
- Device registration with per-device bcrypt-hashed tokens
- Reading ingestion via WebSocket (the firmware's real path) or HTTP, sharing one validated pipeline
- ML water-quality prediction (Random Forest, ~93% test accuracy) with per-class probabilities - open to any active user, logged per-user to power their dashboard stats
- Rule-based + statistical contamination-risk detection, independent of the ML classifier
- Alerting with severity, acknowledgement, and resolution
- Device online/offline status derived from last-seen time, not stored
- Full REST API + role-aware console: dashboard, sensor monitoring, water quality, alerts, devices, ML/prediction, reports, users, system health (the middle five admin-only; dashboard/ML-prediction/reports open to any active user)
- Reproducible dataset generation + a full compare-six-models ML pipeline

## 4. Architecture

```
Sensors -> ESP8266 firmware -> WebSocket -> Vercel Function (api/ws.js)
  -> validate -> authenticate device -> persist (Postgres) -> ML predict
  -> contamination check -> alert -> broadcast -> Admin dashboard
```

Full diagrams (system architecture, IoT communication, software
architecture, data pipeline, ML pipeline, database ER diagram, auth flow,
device lifecycle) are in [`docs/diagrams/`](docs/diagrams/). Architecture
decisions and tradeoffs are recorded as ADRs in
[`docs/architecture/`](docs/architecture/), most importantly
[`adr-002-ml-inference-runtime.md`](docs/architecture/adr-002-ml-inference-runtime.md)
(why the trained Python model runs as plain JavaScript in production) and
[`adr-001-database-choice.md`](docs/architecture/adr-001-database-choice.md).

The single canonical reference for every field name used anywhere in the
system (firmware -> API -> database -> ML -> dashboard) is
[`docs/architecture/data-contract.md`](docs/architecture/data-contract.md).

## 5. Technology stack

| Layer | Technology | Why |
|---|---|---|
| Firmware | ESP8266 (Arduino), WiFiManager, ArduinoJson, WebSockets, ModbusMaster, Adafruit ADS1X15 | Already in place; preserved as-is |
| Backend | Node.js Vercel Serverless Functions (plain handlers + one Express/`ws` WebSocket function) | Matches the project's existing stack; no framework added for simple JSON routes |
| Database | PostgreSQL (any provider via `DATABASE_URL`) | Works identically with Neon, Supabase, or Vercel Postgres; plain SQL migrations, no ORM |
| Auth | JWT (`jsonwebtoken`) + `bcryptjs` | Simple, no native build step (serverless-safe) |
| ML training | Python, pandas, scikit-learn | Real train/evaluate/compare pipeline |
| ML inference (production) | Hand-written JS evaluator over a portable JSON export | No Python/native runtime needed on Vercel - see ADR-002 |
| Frontend | Vanilla HTML/CSS/JS, Chart.js via CDN | No build step, consistent with the existing `index.html` |

## 6. Hardware

RS485/Modbus pH probe + ADS1115 ADC (turbidity on A0, TDS on A1), wired to
an ESP8266. Wiring, calibration formulas, and their honest caveats are in
[`docs/hardware/sensors-and-wiring.md`](docs/hardware/sensors-and-wiring.md).
Firmware behavior (config portal, offline buffering, remote config push,
and its documented security caveat) is in
[`docs/firmware/behavior.md`](docs/firmware/behavior.md).

## 7. ML pipeline

Raw data -> cleaning -> EDA -> feature engineering -> train/test split ->
preprocessing (fit on train only) -> train 6 candidate models -> CV-based
comparison -> deployability-constrained selection -> export -> serve. Full
methodology, the 4-class labeling rule, data-leakage avoidance, the real
model comparison numbers, and a documented lessons-learned bug (a silent
ROC-AUC miscomputation, found and fixed) are in
[`docs/machine-learning/`](docs/machine-learning/). Run it yourself:

```bash
python3 -m venv ml/.venv
ml/.venv/bin/pip install -r ml/requirements.txt
ml/.venv/bin/python ml/data_generation/generate_dataset.py --n-samples 6000 --seed 42
ml/.venv/bin/python -m ml.training.train
ml/.venv/bin/python -m ml.inference.export_portable_model
```

See [`ml/README.md`](ml/README.md) for the full pipeline reference and
[`docs/machine-learning/retraining.md`](docs/machine-learning/retraining.md)
for what changes on disk.

## 8. Dataset

Synthetic, not a public dataset - generated by
`ml/data_generation/generate_dataset.py` from documented per-class
distributions and a documented rule-based labeling methodology (not
arbitrary thresholds). Full methodology and its limitations:
[`docs/machine-learning/target-methodology.md`](docs/machine-learning/target-methodology.md),
[`docs/limitations/ml-limitations.md`](docs/limitations/ml-limitations.md).
See [`data/README.md`](data/README.md) for provenance and regeneration.

## 9. Local development

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm run migrate
npm run seed:admin
npm run seed:model-version   # after training a model (step 7 above)
vercel dev                   # or: npm run dev
```

Then open the local URL Vercel prints - `index.html` for the public
readout, `/admin.html` for the admin console (log in with `ADMIN_EMAIL`
/`ADMIN_PASSWORD`; you'll be forced to set a new password on first login).

## 10. Environment variables

See [`.env.example`](.env.example) for the full list with descriptions:
`DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. Never commit
a real `.env` file - only placeholders belong in git.

## 11. Database setup

Any standard PostgreSQL instance works (Neon, Supabase, Vercel Postgres,
or your own) - just a connection string. Schema, ER diagram, the
device-status-is-derived rule, and why `predictions` merges two spec
concepts into one table are in
[`docs/database/schema.md`](docs/database/schema.md); setup steps are in
[`docs/database/setup.md`](docs/database/setup.md). Migrations are plain
SQL in [`db/migrations/`](db/migrations/), applied with `npm run migrate`.

## 12. Firmware setup

See [`docs/firmware/behavior.md`](docs/firmware/behavior.md) and the
heavily-commented [`firmware/firmware.ino`](firmware/firmware.ino) itself.
Short version: flash it, connect to the `WaterQualityMonitor-Setup` WiFi AP
it opens on first boot, and fill in your WiFi credentials plus the
WebSocket host/device ID/device token (obtained by registering the device
from the admin dashboard's Devices tab, which shows the token exactly
once).

## 13. Running ML training

See section 7 above and [`ml/README.md`](ml/README.md).

## 14. Running tests

```bash
npm test                        # backend unit + integration tests (Node's built-in test runner)
ml/.venv/bin/pytest tests/ml    # ML pipeline tests (pytest)
```

Integration tests need a real Postgres reachable via `DATABASE_URL` (and
`JWT_SECRET` set) and self-skip otherwise - see
[`tests/README.md`](tests/README.md) for standing up a throwaway local
Postgres instance, and
[`docs/testing/testing.md`](docs/testing/testing.md) for the full test
layer breakdown and honest coverage gaps (also tracked in
[`docs/requirements-traceability.md`](docs/requirements-traceability.md)).

## 15. Deployment

Deployed on Vercel. Required environment variables, the WebSocket-state
scaling limitation, and the ML-inference-runtime tradeoff are documented in
[`docs/deployment/vercel.md`](docs/deployment/vercel.md).

## 16. Default development admin account

Set `ADMIN_EMAIL`/`ADMIN_PASSWORD` in `.env`, then run `npm run
seed:admin`. The seeded account always has `must_change_password = true`;
the dashboard forces a password change before granting access to anything
else. Full design: [`docs/backend/authentication.md`](docs/backend/authentication.md).

## 17. API documentation

Full endpoint-by-endpoint contract (method, auth, request/response shapes,
error cases, examples) is in
[`docs/backend/api-contract.md`](docs/backend/api-contract.md). Error
handling conventions (no internal details leaked to clients) are in
[`docs/backend/error-handling.md`](docs/backend/error-handling.md).

## 18. Project limitations

Documented honestly, not hidden:
[`docs/limitations/ml-limitations.md`](docs/limitations/ml-limitations.md)
(synthetic labels, only 3 real sensor features, no lab-confirmed ground
truth), [`docs/limitations/security-limitations.md`](docs/limitations/security-limitations.md)
(no rate limiting, JWT in `localStorage`, single-admin model, and more).

## 19. Future work

[`docs/limitations/future-work.md`](docs/limitations/future-work.md):
real dissolved-oxygen/temperature sensors, lab-validated ground truth,
rate limiting, RBAC, Redis-backed multi-instance WebSocket state, CI.

## Full documentation map

`docs/` also contains a complete requirements-traceability table
([`docs/requirements-traceability.md`](docs/requirements-traceability.md)),
real experiment results
([`docs/experiments/summary.md`](docs/experiments/summary.md),
[`experiments/`](experiments/)), and book/thesis-ready chapter skeletons
([`docs/book-material/`](docs/book-material/)) for anyone extending this
into a longer written report.
