# Deployment (Vercel)

## 1. Current `vercel.json`

```json
{
  "functions": {
    "api/ws.js": {
      "maxDuration": 300
    }
  }
}
```

`api/ws.js` needs a longer `maxDuration` than Vercel's default because it
hosts a long-lived WebSocket connection, not a short request/response
cycle; `300` seconds is the maximum allowed on Vercel's Hobby plan (see
git history: "Fix maxDuration for Hobby plan limit"). Every other route
under `api/*.js` uses Vercel's default Node.js Serverless Function
behavior with no special configuration.

## 2. Required environment variables

Set in the Vercel dashboard (Project Settings -> Environment Variables),
not committed to the repo (`.env.example` documents the shape only):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (Neon/Supabase/Vercel Postgres/any standard provider - see `docs/database/setup.md`) |
| `JWT_SECRET` | Signs/verifies admin JWTs (`api/_lib/auth.js`) |
| `ADMIN_EMAIL` | Used only when running `scripts/seed_admin.js` |
| `ADMIN_PASSWORD` | Used only when running `scripts/seed_admin.js` |

## 3. ML inference runtime

Production prediction runs as plain JavaScript
(`api/_lib/predict.js` evaluating `ml/models/portable_model.json`), not a
Python runtime - this keeps the Vercel deployment to a single Node.js
runtime with no native/binary dependencies. Full reasoning and tradeoffs:
`docs/architecture/adr-002-ml-inference-runtime.md` (not repeated here).

## 4. Known limitation: in-memory WebSocket state doesn't share across instances

`api/ws.js` keeps `lastReading` (the most recent enriched reading, sent
immediately to a newly subscribing viewer) and `viewers` (the set of
connected dashboard WebSocket connections) as plain in-memory module
state. Vercel's native WebSocket support pins a given connection to one
Function instance for its lifetime, and there is **no shared state across
separate instances** - this was true in the original project design and
remains true today.

For this project's actual scale - one low-traffic device, a handful of
dashboard viewers - this is not a practical problem: it's likely (though
not guaranteed) that they land on the same warm instance, and even if they
don't, a viewer that misses one broadcast still gets the next one within
`READ_INTERVAL_MS` (3 seconds). It would become a real problem at higher
traffic or with multiple concurrent devices spread across many cold-started
instances, each with its own disconnected view of `lastReading`/`viewers`.
The documented path to fixing this, if the project ever needs to scale, is
introducing a shared external store (Redis or similar) for both the
last-reading cache and the viewer broadcast fan-out, rather than
in-process memory. See `docs/limitations/security-limitations.md` and
`docs/limitations/future-work.md`.

## 5. Two real deployment pitfalls (found during the actual first deploy)

Both of these were caught by an actual `vercel deploy --prod` failing or
serving the wrong thing, not discovered by inspection - recorded here so
they aren't reintroduced.

**Shared helper modules under `api/` count against the function limit.**
Vercel's Node.js runtime treats every `.js` file under `api/` as its own
Serverless Function, including files meant purely as shared library code
(`api/lib/db.js`, `api/lib/http.js`, etc. as they were originally laid
out). With 11 real routes plus 9 shared modules, that's 20 functions -
over the Hobby plan's 12-function-per-deployment limit, and the deploy
failed outright with `deploy_failed`. The fix: Vercel excludes files and
folders whose name starts with an underscore from function detection
while still allowing them to be imported, so the shared modules now live
in `api/_lib/` instead of `api/lib/`. If you add new shared backend code,
put it in `api/_lib/`, not loose in `api/`.

**A top-level `public/` directory becomes the entire static web root.**
Once `public/css/` and `public/js/` existed (for the admin dashboard's
assets), Vercel's zero-config static-file handling started treating
`public/` as the site's document root and serving *only* its contents -
at the URL with the `public` segment stripped (`public/css/admin.css` ->
`/css/admin.css`). Root-level loose files like `index.html` and
`admin.html` stopped being served at all (`404 NOT_FOUND`), and
`admin.html`'s own `/public/css/...`/`/public/js/...` asset references
were wrong for the same reason. Both pages now live under `public/`
(`public/index.html`, `public/admin.html`) with asset references rewritten
to the stripped-prefix form (`/css/admin.css`, `/js/app.js`). See
`docs/frontend/dashboard.md`. `scripts/dev_server.js` mirrors this exact
convention locally so local dev and production behave the same way.

## 6. Function count accounting (kept current as features are added)

The `api/_lib/` fix above bought headroom, but every *new route* still
costs one function against the same 12-function Hobby-plan ceiling. When
multi-user support (registration, user management, report export) was
added, four planned new endpoints would have pushed the count to 14. The
fix applied then: consolidate the four auth actions (login, register, me,
change-password) - which differ only in request parsing, not routing
concerns - into one dynamic route, `api/auth/[action].js`, dispatching on
`req.query.action`. See that file's header comment. Current accounting:

| File | Routes it serves |
|---|---|
| `api/ws.js` | WebSocket relay |
| `api/auth/[action].js` | login, register, me, change-password |
| `api/devices/index.js` | list, register device |
| `api/devices/[deviceId].js` | device detail |
| `api/readings.js` | query, manual ingest |
| `api/predict.js` | what-if prediction |
| `api/predictions.js` | list predictions |
| `api/alerts.js` | list, acknowledge/resolve |
| `api/dashboard.js` | role-aware dashboard stats (admin cross-platform / user self-scoped), plus system health for the System tab |
| `api/users/index.js` | list, activate/deactivate |
| `api/reports/[type].js` | CSV/PDF export |

11 functions total, 1 under the limit. Before adding another `api/*.js`
file, either fold it into an existing dynamic route (as above) or confirm
the count still fits - `find api -name "*.js" -not -path "api/_lib/*" | wc -l`.

## 7. Deploying

```
npm install
npx vercel deploy --prod
```

Before the first deploy (or after provisioning a new database), run the
database setup steps in `docs/database/setup.md` (`npm run migrate`,
`npm run seed:admin`, `npm run seed:model-version`) against the target
`DATABASE_URL`.
