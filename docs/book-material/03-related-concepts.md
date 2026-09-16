# Chapter 3: Related Concepts

This chapter situates the project's real technical choices against the
broader concepts they draw from, without claiming novelty beyond what was
actually implemented. Four concept areas are directly relevant to what
this system does.

**IoT sensor telemetry over WebSocket.** Rather than a polling HTTP model,
the firmware maintains a persistent WebSocket connection
(`firmware/firmware.ino`, `WebSocketsClient`) to push readings as they're
taken, with the server (`api/ws.js`) also broadcasting enriched readings
back out to dashboard viewers over the same protocol. This is a standard
pattern for low-latency telemetry, chosen here specifically because it
matched the project's pre-existing stack rather than being introduced new
(see `docs/architecture/adr-002-ml-inference-runtime.md`'s context section
for that history).

**Supervised multiclass classification on tabular sensor data.** The core
ML task - three numeric features, four ordered severity classes - is a
standard supervised classification problem, and the project's methodology
(stratified train/test split, cross-validation for model selection,
held-out test evaluation exactly once) follows standard practice for
avoiding data leakage and overCVfitting in exactly that setting (Chapter
10-12, `docs/machine-learning/methodology.md`).

**Rule-based and statistical anomaly detection**, used here as a
complement to (not a replacement for) the ML classifier -
`api/_lib/contamination.js` combines fixed engineering thresholds with a
z-score-based deviation check against a device's own recent history
(Chapter 10, `docs/machine-learning/contamination-detection.md`).

**Serverless deployment constraints on ML inference.** Running a trained
model behind a serverless function (as opposed to a long-lived server
process) constrains what inference runtime is practical - this project's
resolution (exporting model parameters to a portable JSON format and
evaluating them with hand-written JavaScript, rather than bundling a
second runtime) is documented in full in
`docs/architecture/adr-002-ml-inference-runtime.md` and is directly
relevant background for Chapter 13.

## Outline

- IoT telemetry patterns: polling vs. persistent connections, and why this
  project uses the latter
- Multiclass classification methodology basics as applied here (CV,
  stratification, leakage avoidance)
- Contamination/anomaly detection as a complement to classification, not a
  substitute
- Serverless ML inference constraints and the portable-model-export
  pattern used to satisfy them
- Explicitly not covered: this is not a survey of the broader water-quality
  sensing literature; it documents this project's specific choices
