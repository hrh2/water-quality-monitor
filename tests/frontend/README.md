# Frontend Tests

The dashboard (`admin.html` + `public/js/`) is intentionally built as
vanilla HTML/CSS/JS with no build step and no framework (see
`docs/frontend/` and `docs/architecture/adr-001-database-choice.md`'s
sibling reasoning about preferring the existing, already-Vercel-compatible
stack). Introducing a component-testing framework (e.g. jsdom + a test
runner) purely to test a few hundred lines of vanilla DOM/fetch code would
add real dependency weight for limited return at this project's scale.

**Current state: no automated frontend tests exist.** This is a documented
limitation, not an oversight - see `docs/limitations/`. Frontend
verification is currently manual: exercise each dashboard tab against a
real backend (see `docs/testing/testing.md` for how to stand up a local
Postgres + `npm run migrate` + `npm run seed:admin`), confirming the
loading/empty/error states described in `docs/frontend/` actually render
correctly for each case (no devices yet, API error, populated data).

If the dashboard grows significantly, the natural next step (see
`docs/limitations/future-work.md`) would be adding a lightweight DOM
testing setup (e.g. `jsdom` with Node's built-in test runner, consistent
with `tests/backend`'s no-framework approach) rather than a full
browser-based e2e framework.
