# Chapter 16: Testing

Three genuinely different test layers exist, each using the simplest tool
appropriate to what it tests, rather than a single framework imposed
uniformly: `tests/backend/` (Node's built-in `node --test`, pure functions,
no database needed), `tests/integration/` (same runner, but requires a
real Postgres and self-skips otherwise), and `tests/ml/` (`pytest`,
covering dataset-generation determinism and preprocessing leakage
properties). The full breakdown of what each layer actually covers is in
`docs/testing/testing.md`; the exact commands to run each, including
standing up a disposable local Postgres for the integration layer, are in
`tests/README.md`.

This chapter's fuller version should be as honest about what is *not*
tested as about what is: no automated test currently exercises the HTTP
route handlers directly (`api/auth/*.js`, `api/devices/*.js`, etc. -
coverage there is indirect, through the shared library functions they
call), there is no automated re-verification of JS/Python inference parity
on every run, and there is no CI pipeline running any of this
automatically as of this writing. See
`docs/requirements-traceability.md` for the requirement-by-requirement
honest accounting of test coverage.

## Outline

- Three test layers and their tools (`node --test` x2, `pytest`)
- What `tests/backend/*.test.js` covers: contamination, device status,
  prediction, validation - all pure functions
- What `tests/integration/ingest.integration.test.js` covers: full
  pipeline against a real database, self-skipping design
- What `tests/ml/test_*.py` covers: dataset generation and preprocessing
  properties
- Local test-database setup (`tests/README.md`)
- Honest gaps: route-handler tests, automated parity checks, CI
  (`docs/testing/testing.md` §4, `docs/requirements-traceability.md`)
