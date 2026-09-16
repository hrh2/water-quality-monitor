# Chapter 20: Future Work

Future work follows directly from the limitations enumerated in Chapter
19 and detailed in `docs/limitations/future-work.md` - this chapter's
fuller version should prioritize among them rather than merely list them
again. Three groupings are worth structuring the fuller chapter around:
closing the ML/data validity gap (real dissolved-oxygen and temperature
sensors, lab-validated ground-truth labels, field-collected training
data, per-device sensor calibration), closing the security/engineering
gaps (rate limiting, RBAC, refresh-token rotation, Redis-backed shared
state for `api/ws.js` to support multi-instance scaling, connection-time
device authentication, full TLS certificate validation), and closing the
process gaps (automated route-handler tests, an automated JS/Python
parity check on every retrain, and a CI pipeline running the existing test
suites automatically).

Of these, the single highest-leverage next step for the project's core
claim is arguably **lab-validated ground-truth data** - every other
result in this project (model comparison, evaluation metrics, JS/Python
parity) is technically sound but ultimately validates the pipeline against
itself; only real, lab-confirmed labels paired with this specific sensor
rig's real readings would let this project make a genuine real-world
accuracy claim rather than a synthetic-rule-recovery claim.

## Outline

- ML/data validity gap: real temperature/DO sensors, lab-validated labels,
  field data collection, per-device calibration
  (`docs/limitations/future-work.md` "ML / data")
- Security/engineering gap: rate limiting, RBAC, refresh tokens,
  Redis-backed WS state, connection-time device auth, full TLS validation
  (`docs/limitations/future-work.md` "Backend / security")
- Process gap: route-handler tests, automated parity checks, CI
  (`docs/limitations/future-work.md` "Testing / process")
- Prioritization: why lab-validated ground truth is the highest-leverage
  next step for the project's core scientific claim
- What a first field deployment would need before it could happen safely
  (rate limiting and RBAC arguably block it more than ML accuracy does)
