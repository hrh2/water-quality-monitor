# Testing

Three real, distinct test layers exist in this project. None of them share
a test framework across languages by design - each uses the simplest tool
that fits its layer.

## 1. `tests/backend/` - pure-function unit tests

- Runner: Node's built-in `node --test` (no framework dependency - `assert/strict` from `node:assert`).
- Files: `contamination.test.js`, `devices.test.js`, `predict.test.js`, `validation.test.js`.
- Scope: pure functions in `api/_lib/*.js` that need no database or network -
  `ruleBasedContaminationFlag`/`statisticalAnomalyFlag`/`assessContaminationRisk`
  (`api/_lib/contamination.js`), `deriveDeviceStatus`
  (`api/_lib/devices.js`), `predictWaterQuality`/`getModelMetadata`
  (`api/_lib/predict.js`, exercised against the **real, live**
  `ml/models/portable_model.json` - not a mock), and
  `validateReadingPayload` (`api/_lib/validation.js`).
- Run: `npm test` (root `package.json` script: `node --test`), which
  discovers and runs every `*.test.js` under `tests/` by default,
  including this layer.

## 2. `tests/integration/` - full pipeline against a real Postgres

- Runner: the same `node --test`, one file:
  `ingest.integration.test.js`.
- Scope: the complete `ingestReading()` pipeline
  (`api/_lib/ingest.js`) end to end - device registration, reading
  ingestion, prediction, contamination assessment, alert creation, and
  `last_seen_at` update - and the wrong-device-token rejection path
  (`IngestError` with `statusCode === 401`).
- **Requires a real Postgres** reachable via `DATABASE_URL`, with the
  schema already migrated, plus `JWT_SECRET` set. It **self-skips** (not a
  failure) via `node:test`'s `{ skip: ... }` option when either is unset,
  so `npm test` still runs the pure unit suites without a database
  available.
- Cleans up its own rows (`DELETE FROM devices WHERE device_id = ...`) in
  a `finally` block, and closes the shared `pg.Pool` in an `after()` hook
  so `node --test` can actually exit afterward.
- See `tests/README.md` for the exact steps to stand up a throwaway local
  Postgres for this layer.

## 3. `tests/ml/` - dataset generation and preprocessing properties

- Runner: `pytest`.
- Files: `test_dataset_generation.py`, `test_preprocessing.py`.
- Scope:
  - **Dataset generation determinism and correctness**
    (`ml/data_generation/generate_dataset.py`): same seed produces
    identical output, different seeds produce different output, all four
    classes appear, `ph` has missing values but `turbidity_ntu`/`tds_ppm`
    never do, the `assign_category`/`*_penalty` functions match the
    documented threshold table
    (`docs/machine-learning/target-methodology.md`), and no sensor value
    is ever negative.
  - **Preprocessing leakage properties**
    (`ml/preprocessing/preprocessing.py`): the returned transformer is
    genuinely unfitted until explicitly fit (`transform` before `fit`
    raises), the imputer's learned median comes only from the training
    data it was fit on (not from whatever it's later asked to transform),
    and output shape matches the expected feature count.
- Run (from the repository root, so `ml` is importable):
  ```
  ml/.venv/bin/pytest tests/ml
  ```

## 4. What is not yet covered

- No automated test currently exercises the HTTP route handlers
  (`api/auth/*.js`, `api/devices/*.js`, `api/readings.js`, `api/predict.js`,
  `api/predictions.js`, `api/alerts.js`, `api/dashboard.js`) directly -
  coverage there is indirect, through the shared `api/_lib/*` functions they
  call, plus the integration test's exercise of `ingestReading`.
- No automated test re-verifies JS/Python inference parity on every run -
  that is a manual, point-in-time check
  (`docs/experiments/reports/js-python-parity.md`), though
  `tests/backend/predict.test.js` does provide ongoing regression coverage
  of the live exported model's output shape and sane behavior.
- No frontend/dashboard tests exist in this repository
  (`tests/frontend/` is present but empty at the time of writing).

See `docs/requirements-traceability.md` for the full requirement-by-
requirement test coverage table, including where coverage is honestly
absent.
