# Chapter 5: System Architecture

The system is organized into four tiers: a physical sensor/firmware tier,
a Vercel-hosted serverless backend tier, a PostgreSQL persistence tier,
and an admin dashboard tier. A single reading's path through all four -
from an ADS1115 ADC count to a broadcast dashboard update - is the
clearest way to understand how they fit together, and is walked through in
full in `docs/architecture/overview.md`, with the corresponding Mermaid
diagram in `docs/diagrams/01-system-architecture.md`.

Two architectural decisions recur throughout the rest of this book and are
worth foregrounding here. First, the backend deliberately runs ML
inference as plain JavaScript rather than introducing a second (Python)
runtime into the Vercel deployment - a choice driven entirely by
serverless deployment constraints, documented with its full tradeoff
analysis in `docs/architecture/adr-002-ml-inference-runtime.md`. Second,
the database layer is plain PostgreSQL addressed only through a
connection string, with hand-written SQL migrations instead of an ORM,
chosen for the same "avoid unnecessary abstraction on a small system"
principle (`docs/architecture/adr-001-database-choice.md`).

The backend itself is not monolithic: `api/_lib/ingest.js` is the single
shared pipeline both the real device path (`api/ws.js`) and a manual/
testing HTTP path (`api/readings.js`) call, which is what guarantees the
two entry points can't silently diverge in behavior - a detail visible in
`docs/diagrams/03-software-architecture.md` and important enough to design
around explicitly rather than duplicate logic across the two entry
points.

## Outline

- Four-tier breakdown: hardware, backend, database, dashboard
- The single-reading walkthrough (sensor to broadcast) as the
  organizing narrative (`docs/architecture/overview.md`)
- Two ingestion entry points, one shared pipeline
  (`docs/diagrams/04-data-pipeline.md`)
- Key architecture decisions and their tradeoffs: ML inference runtime
  (ADR-002), database choice (ADR-001)
- Known scaling limitation: in-memory WebSocket state per Vercel Function
  instance (`docs/deployment/vercel.md` §4) - explicitly not yet solved,
  see Chapter 20
