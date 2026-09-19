# Future Work

Realistic next steps, grounded in the specific gaps documented in
`docs/limitations/ml-limitations.md` and
`docs/limitations/security-limitations.md`.

## ML / data

- **Real dissolved-oxygen and temperature sensors.** Add the physical
  sensors, add their fields to `docs/architecture/data-contract.md` and
  every layer listed there (firmware payload, WebSocket relay, database
  schema, ML dataset, prediction API, dashboard) - not just one layer -
  and retrain (`docs/machine-learning/retraining.md`) with the expanded
  feature set.
- **Lab-validated ground truth labels.** Replace or supplement the
  rule-derived `water_quality_category` with labels from actual
  microbiological/chemical lab testing on real water samples measured by
  this specific sensor rig, closing the gap described in
  `docs/limitations/ml-limitations.md` §1.
- **Field-collected training data.** Log real sensor readings over time
  (the schema already supports this via `sensor_readings`) and use them,
  alongside or instead of the synthetic dataset, once enough real-world
  variety and labeled outcomes exist.
- **Per-device sensor calibration.** Replace the generic published
  turbidity/TDS calibration curves (`docs/hardware/sensors-and-wiring.md`
  §3) with curves fitted against reference standards for each physical
  sensor unit.

## Backend / security

- **Rate limiting** on `POST /api/auth/login`/`register` (with
  backoff/lockout after repeated failures) and on the reading-ingestion
  endpoints.
- **Finer-grained RBAC** - a two-role model (`admin`/`user`) now exists
  (`users.role`), but there's no permission tier finer than that (e.g. a
  read-only admin, a per-device-scoped admin) and no in-app way to promote
  a `user` to `admin` - only `scripts/seed_admin.js`, run outside the app.
- **Email verification** on `POST /api/auth/register` - currently none.
- **Refresh-token rotation** and a token-revocation mechanism, instead of
  relying solely on a fixed 12-hour JWT expiry.
- **Redis-backed (or similar) shared state for `api/ws.js`**, replacing the
  in-memory `lastReading`/`viewers` module state so broadcast and
  last-reading caching work correctly across multiple concurrent Vercel
  Function instances - needed before this system could support many
  devices or many concurrent dashboard viewers at once
  (`docs/deployment/vercel.md` §4).
- **Connection-time device authentication** for `api/ws.js`, closing the
  `set_config`-over-open-WebSocket hijack risk documented in
  `docs/limitations/security-limitations.md` §6 and in
  `firmware/firmware.ino`'s own comments.
- **Full TLS certificate validation** against the managed Postgres
  provider's actual CA chain, replacing `rejectUnauthorized: false`
  (`docs/limitations/security-limitations.md` §7).

## Testing / process

- **HTTP route-handler tests** for `api/auth/*.js`, `api/devices/*.js`,
  `api/readings.js`, `api/predict.js`, `api/predictions.js`,
  `api/alerts.js`, `api/dashboard.js` - currently only indirectly
  covered through the shared `api/_lib/*` functions
  (`docs/testing/testing.md` §4).
- **An automated JS/Python inference-parity test** that runs on every
  retrain, rather than the current manual, point-in-time check
  (`docs/experiments/reports/js-python-parity.md`).
- **A CI pipeline** running `npm test` and
  `ml/.venv/bin/pytest tests/ml` on every push/PR - neither currently runs
  automatically outside a developer's local machine, as far as this
  repository shows.

## Deployment / scale

- Real field deployment and monitoring of the system against actual
  water sources, to validate (or reveal problems with) everything above
  in practice - **this has not yet happened**; there is no field
  deployment data anywhere in this repository, and no results chapter in
  this documentation set claims otherwise.
