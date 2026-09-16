# Chapter 18: Deployment

The system deploys as a set of Vercel Node.js Serverless Functions
(`api/*.js`), configured by a minimal `vercel.json` that sets
`maxDuration: 300` specifically for `api/ws.js`, since it hosts a
long-lived WebSocket connection rather than a short request/response
cycle (`docs/deployment/vercel.md`). Four environment variables
(`DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`) are the
entire deployment-specific configuration surface - there is no
provider-specific database SDK or vendor lock-in beyond a standard
Postgres connection string (`docs/architecture/adr-001-database-choice.md`).

This chapter's fuller version should walk through the deployment sequence
in order (provision Postgres, set environment variables, run migrations
and seed scripts, deploy) and then spend real space on the one deployment
constraint that shaped a major architectural decision elsewhere in this
book: because production inference runs inside these same serverless
functions, it could not depend on a native ML runtime or a bundled Python
interpreter without meaningfully complicating the deployment - which is
exactly why the portable-JSON-export approach exists
(`docs/architecture/adr-002-ml-inference-runtime.md`, cross-referenced
from Chapter 10-11 as well). The chapter should also state plainly the
one deployment-scale limitation that remains open: `api/ws.js`'s
in-memory state does not share across concurrent Function instances,
which is fine at this project's current scale and documented as a
concrete next step otherwise (`docs/deployment/vercel.md` §4).

## Outline

- Deployment sequence: provision Postgres, set env vars, migrate, seed,
  `vercel deploy --prod` (`docs/deployment/vercel.md`,
  `docs/database/setup.md`)
- `vercel.json` and why `api/ws.js` needs `maxDuration: 300`
- Why ML inference had to be deployment-runtime-compatible, and the
  chosen resolution (ADR-002, cross-reference to Chapter 10-11)
- Known scaling limitation: in-memory WS state per instance
  (`docs/deployment/vercel.md` §4) and its documented next step (Chapter 20)
