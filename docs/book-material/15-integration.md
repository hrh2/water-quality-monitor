# Chapter 15: Integration

Integration in this project means specifically: the point where a Python-
trained model becomes a JavaScript-evaluated artifact inside a serverless
request path, and the point where two independent backend entry points
(device WebSocket, manual HTTP) converge onto one shared pipeline. Both
are deliberate integration-boundary designs, not incidental wiring.

The ML/backend integration boundary is a single JSON file,
`ml/models/portable_model.json`, produced by
`ml/inference/export_portable_model.py` from the fitted scikit-learn
pipeline, and consumed by `api/_lib/predict.js`'s hand-written evaluator.
This boundary was manually verified for numerical parity (identical class
probabilities to four decimal places across four representative inputs)
before being relied on in production -
`docs/experiments/reports/js-python-parity.md` documents that check and
its explicit caveat that it is a point-in-time manual verification, not a
continuously re-run property test, and should be re-run if the deployed
model family ever changes.

The ingestion integration boundary is `api/_lib/ingest.js::ingestReading`,
called identically from `api/ws.js` (the firmware's real path) and
`api/readings.js` (`POST`, the manual/testing path) - see
`docs/diagrams/04-data-pipeline.md`. This is what prevents the two entry
points from silently behaving differently as the system evolves.

## Outline

- ML/backend integration: the portable JSON export boundary
  (`docs/architecture/adr-002-ml-inference-runtime.md`)
- JS/Python parity verification: method, result, and its stated limits
  (`docs/experiments/reports/js-python-parity.md`)
- Ingestion integration: one pipeline, two entry points
  (`docs/diagrams/04-data-pipeline.md`)
- Database integration: any standard Postgres provider via connection
  string only (`docs/architecture/adr-001-database-choice.md`)
- What is not yet integration-tested: dashboard <-> backend, beyond the
  documented contract itself (see Chapter 16)
