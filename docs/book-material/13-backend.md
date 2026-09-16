# Chapter 13: Backend

The backend is a set of Vercel Node.js Serverless Functions under `api/`,
built around one core principle visible throughout the codebase: shared
logic lives in `api/_lib/*.js` and is called identically from every route
that needs it, rather than being re-implemented per endpoint. The clearest
example is `api/_lib/ingest.js::ingestReading`, called identically by the
device's real WebSocket path (`api/ws.js`) and the manual/testing HTTP
path (`POST /api/readings`), guaranteeing the two cannot drift apart in
validation, authentication, prediction, or alerting behavior.

Three backend subsystems deserve their own sub-sections in this chapter's
fuller version: authentication (bcrypt + JWT, a forced first-login
password change, and the documented localStorage tradeoff -
`docs/backend/authentication.md`), error handling (a generic wrapper that
never leaks internal detail to clients, plus a typed `IngestError` for
expected rejections that do need specific status codes -
`docs/backend/error-handling.md`), and the full REST API surface
(`docs/backend/api-contract.md`), which this chapter should walk through
by resource (auth, devices, readings, predictions, alerts, system health)
rather than repeating the full contract inline.

## Outline

- Design principle: shared `api/_lib/*` logic, thin route handlers
  (`docs/diagrams/03-software-architecture.md`)
- Authentication subsystem (`docs/backend/authentication.md`)
- Error-handling subsystem (`docs/backend/error-handling.md`)
- REST API surface by resource (`docs/backend/api-contract.md`)
- The WebSocket relay (`api/ws.js`) as a special case: not a REST route,
  covered separately (Chapter 15, `docs/diagrams/04-data-pipeline.md`)
- Known limitation: in-memory WS state per instance
  (`docs/deployment/vercel.md` §4)
