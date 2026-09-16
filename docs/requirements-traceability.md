# Requirements Traceability

Requirement -> Implementation -> Test -> Documentation, using real file
paths only. Where no automated test exists, that is stated honestly rather
than implied.

| Requirement | Implementation | Test | Documentation |
|---|---|---|---|
| Sensor data ingestion (device -> server) | `api/ws.js`, `api/_lib/ingest.js::ingestReading`, `api/readings.js` (POST) | `tests/integration/ingest.integration.test.js` (full pipeline, requires DB); `tests/backend/validation.test.js` (payload validation, pure) | `docs/architecture/data-contract.md`, `docs/backend/api-contract.md`, `docs/diagrams/04-data-pipeline.md` |
| Device authentication (per-device token) | `api/_lib/ingest.js::authenticateDevice`, `devices.device_token_hash` (bcrypt) | `tests/integration/ingest.integration.test.js` ("wrong device token is rejected...") | `docs/backend/api-contract.md`, `docs/diagrams/08-device-lifecycle.md` |
| Admin authentication (JWT) | `api/_lib/auth.js`, `api/auth/login.js`, `api/auth/change-password.js`, `api/auth/me.js` | `tests/integration/auth.integration.test.js` (login/bad-password, `/me` with/without token, forced-change-password round trip, short-password rejection) | `docs/backend/authentication.md`, `docs/diagrams/07-authentication-flow.md` |
| Water quality prediction | `ml/training/train.py`, `ml/inference/export_portable_model.py`, `api/_lib/predict.js::predictWaterQuality` | `tests/backend/predict.test.js` (live exported model: probabilities sum to 1, argmax matches confidence, null-ph imputation, extreme/clean-value category checks); `tests/ml/test_dataset_generation.py`, `tests/ml/test_preprocessing.py` (upstream pipeline properties) | `docs/machine-learning/methodology.md`, `docs/machine-learning/model-comparison.md`, `docs/architecture/adr-002-ml-inference-runtime.md` |
| Contamination detection | `api/_lib/contamination.js` | `tests/backend/contamination.test.js` (rule-based, statistical, combined) | `docs/machine-learning/contamination-detection.md` |
| Alerting | `api/_lib/alerts.js::createAlertsIfNeeded`, `api/alerts.js` (GET/PATCH) | `tests/integration/ingest.integration.test.js` (asserts a Critical reading creates a `critical`-severity alert); no dedicated unit test for the 15-minute dedup window itself | `docs/backend/api-contract.md`, `docs/database/schema.md` |
| Device online/offline status | `api/_lib/devices.js::deriveDeviceStatus` | `tests/backend/devices.test.js` (never-connected, online, offline, connection-error cases) | `docs/database/schema.md` ("Device status rule"), `docs/diagrams/08-device-lifecycle.md` |
| Historical readings queries | `GET /api/readings`, `GET /api/devices/:deviceId`, `GET /api/predictions` | `tests/integration/queries.integration.test.js` (filtering by device/category, 401 without auth, 404 for unknown device) | `docs/backend/api-contract.md` |
| Model training reproducibility | `ml/training/train.py` (`RANDOM_SEED = 42` used throughout), `ml/models/model_metadata.json` (records seed/test_size/cv_folds/dataset) | `tests/ml/test_dataset_generation.py::test_generation_is_reproducible_with_fixed_seed` | `docs/machine-learning/methodology.md` §3, `docs/machine-learning/retraining.md` |
| Data-leakage avoidance | `ml/preprocessing/preprocessing.py::build_preprocessor` (unfitted until fit in `train.py`), `ml/training/train.py` (CV on train only, test scored once) | `tests/ml/test_preprocessing.py::test_preprocessor_is_unfit_until_explicitly_fit`, `test_preprocessor_imputes_median_from_fit_data_only` | `docs/machine-learning/methodology.md` §2 |
| Vercel deployment compatibility | `vercel.json` (`maxDuration: 300` for `api/ws.js`), `api/_lib/predict.js` (dependency-free JS inference, no native/Python runtime), `api/_lib/` (underscore-prefixed to stay under the 12-function Hobby limit), `public/` (static-root convention) | Not covered by an automated test - verified by an actual `vercel deploy --prod` to a live Neon-backed production deployment, which surfaced and fixed two real issues (function-count limit, static-root convention); no CI check re-verifies this on every change | `docs/deployment/vercel.md` §5, `docs/architecture/adr-002-ml-inference-runtime.md` |
| Engineering-range reading validation (flag, not drop) | `api/_lib/validation.js::validateReadingPayload` | `tests/backend/validation.test.js` | `docs/backend/api-contract.md`, `docs/database/schema.md` (`is_valid`/`validation_notes`) |
| Error handling (no internal detail leaked) | `api/_lib/http.js::withErrorHandling`, `api/_lib/ingest.js::IngestError` | Not yet covered by an automated test (no test asserts the 500 response shape or that `system_events` receives an `unhandled_error` row) | `docs/backend/error-handling.md` |

## Honest gaps summary

Rows marked "Not yet covered by an automated test" above are real gaps,
not oversights hidden from this table: Vercel-specific deployability and
the generic error-handling wrapper's exact response shape. The admin auth
flow and historical query endpoints, previously gaps, are now covered by
`tests/integration/auth.integration.test.js` and
`tests/integration/queries.integration.test.js`. See
`docs/testing/testing.md` §4 and `docs/limitations/future-work.md` for the
plan to close the remaining ones.
