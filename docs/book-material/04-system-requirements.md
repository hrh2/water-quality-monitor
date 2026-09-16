# Chapter 4: System Requirements

The requirements below are stated at the level actually implemented and
verifiable in this repository - see
`docs/requirements-traceability.md` for the full requirement ->
implementation -> test -> documentation table this chapter summarizes.

**Functional requirements actually implemented:** ingest sensor readings
from an authenticated device over WebSocket or HTTP
(`api/_lib/ingest.js`); validate readings against engineering-plausible
ranges without dropping implausible-but-parseable ones
(`api/_lib/validation.js`); predict a water-quality category with a
confidence score (`api/_lib/predict.js`); independently assess
contamination risk (`api/_lib/contamination.js`); raise deduplicated
alerts at appropriate severity (`api/_lib/alerts.js`); derive device
online/offline status without storing it directly
(`api/_lib/devices.js`); expose admin-authenticated REST endpoints for
device management, historical queries, and system health
(`docs/backend/api-contract.md`).

**Non-functional requirements actually implemented:** no internal error
detail leaked to clients (`api/_lib/http.js::withErrorHandling`); device
identity is authenticated per-token, not by a single shared secret
(`devices.device_token_hash`); the ML inference path has zero native
runtime dependencies, keeping the Vercel deployment to one Node.js
runtime (`docs/architecture/adr-002-ml-inference-runtime.md`); the
database layer works against any standard Postgres provider via a
connection string with no vendor-specific code
(`docs/architecture/adr-001-database-choice.md`).

**Requirements explicitly not met yet**, stated honestly rather than
implied as done: rate limiting, RBAC, refresh-token rotation, and CI
automation are all real gaps, not yet implemented
(`docs/limitations/security-limitations.md`, `docs/limitations/future-work.md`).

## Outline

- Functional requirements table (ingestion, auth, prediction,
  contamination detection, alerting, device status, historical queries)
- Non-functional requirements (error handling, security posture,
  deployability, database portability)
- Traceability: pointer to `docs/requirements-traceability.md` as the
  living source of truth rather than duplicating it here
- Requirements deliberately out of scope for this project (lab-grade
  potability certification, pathogen identification - see Chapter 2)
