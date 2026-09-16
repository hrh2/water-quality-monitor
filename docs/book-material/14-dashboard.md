# Chapter 14: Dashboard

The admin dashboard (the frontend under `public/`, `admin.html`,
`index.html`) is being built as a separate work stream in parallel with
this documentation set, and is intentionally out of scope for the
documents this chapter set draws from - this book chapter should be
written (or substantially revised) once that frontend work is complete
and can be described accurately from its own real implementation, rather
than assumed here.

What can be stated accurately now, because it is fixed by the backend
contract the dashboard must consume, is the interface the dashboard is
built against: a WebSocket connection to `/api/ws` for real-time enriched
readings (subscribe via `{"type": "subscribe"}`, receive the last known
reading immediately, then every subsequent broadcast), and a JWT-authenticated
REST API for everything else - device management, historical queries,
predictions, alerts, and system health
(`docs/backend/api-contract.md`). The dashboard is expected to store its
issued JWT in browser `localStorage`, a documented and accepted tradeoff
for this project's scope (`docs/backend/authentication.md` §6).

## Outline

- The contract the dashboard consumes: WebSocket subscribe protocol +
  REST endpoints (`docs/backend/api-contract.md`)
- Real-time update flow: `subscribe` -> immediate last-reading ->
  ongoing broadcast (`docs/diagrams/04-data-pipeline.md`)
- Authenticated flow: login, forced password change, JWT storage
  tradeoff (`docs/backend/authentication.md`)
- This chapter to be completed/revised once the frontend implementation
  is finalized by its own work stream - not yet written from a real UI
  implementation as of this documentation pass
