# Frontend

Two static, framework-free HTML pages, served directly by Vercel (no build
step - matches the project's "prefer simple, already-Vercel-compatible"
principle):

| Page | Audience | Purpose |
|---|---|---|
| `index.html` (URL `/index.html` and `/`) | Public | Live single-device readout over the `/api/ws` WebSocket, unauthenticated (as it always was in the original project) |
| `admin.html` (URL `/admin.html`) | Any authenticated user, either role | One console, role-aware content - see below |

Both pages live under `public/` on disk (`public/index.html`,
`public/admin.html`), not the repository root - Vercel's static-file
convention serves everything under a top-level `public/` directory as the
site root (the `public` segment itself is stripped from the URL), so this
is where they have to live for `/index.html` and `/admin.html` to resolve
in production. See `docs/deployment/vercel.md`.

## Console architecture

```
public/admin.html                # shells: login, register, forced change-password screens, app shell with 9 <section id="tab-*"> containers
public/css/admin.css            # extends index.html's CSS variables (--bg/--panel/--line/--text/--text-dim/--accent/--warn/--danger), adds a light theme via [data-theme="light"]
public/js/api.js                # fetch wrapper: attaches `Authorization: Bearer <token>`, centralizes 401 -> logout handling, distinguishes ApiError (has .status) vs NetworkError
public/js/current-user.js       # tiny in-memory store for the logged-in user's own profile (role, first_name, ...), set once at boot from a live /api/auth/me call - never persisted, so it can't go stale
public/js/utils.js              # relative-time/date formatting, category/severity/status/role badge HTML, shared loading/error/empty state renderer
public/js/charts.js             # thin Chart.js wrapper (line, doughnut, bar), each chart's container uses CSS `min-width: 0` inside `.grid-2`/`.grid-3` so Chart.js's responsive resize doesn't push a row past the viewport
public/js/auth-screens.js       # login, register, and the non-skippable forced password-change form
public/js/app.js                # boot sequence, ROLE-BASED nav visibility, tab routing, theme toggle, a single shared /api/ws connection (view-only, for the topbar live/disconnected indicator), logout, global 401 -> login redirect
public/js/sections/*.js         # one module per tab: dashboard, sensors, waterquality, alerts, devices, ml, reports, users, system
```

Every section module fetches its own data on activation (no polling loop),
renders one of: a loading state, a real empty state (e.g. "no devices
registered yet" when `devices.total === 0`), a real error state (network
failure or non-2xx response - never a blank panel), or the populated view.
No section ever fabricates placeholder data to "look populated."

## Role-based navigation

`app.js`'s `ADMIN_ONLY_TABS` set hides the Sensor Monitoring, Water
Quality, Alerts, Devices, Users, and System nav items entirely for a
`role='user'` account (`li[data-role="admin"]` gets the `hidden` class) -
rather than showing them and letting the API 403. `Dashboard`, `ML /
Prediction`, and `Reports` are visible to every role. This is applied
once, right after `/api/auth/me` resolves at boot
(`app.js::applyRoleVisibility`), from the live server response - never
from a value cached across page loads.

## Dashboard tab: same tab name, different data by role

`public/js/sections/dashboard.js` is one module that branches entirely on
`getCurrentUser().role`:

- **Admin**: cross-platform stats - every device, every reading, every
  registered user, total what-if predictions and reports exported across
  *all* users - plus a water-quality-category donut chart and the latest
  prediction, mirroring what the old "Overview" tab showed (renamed to
  "Dashboard" - the same tab an admin used to land on).
- **Regular user**: stats scoped to *only that user's own activity* - how
  many what-if predictions they've personally run, their own category
  breakdown as a donut chart, their own recent predictions, and how many
  reports they've personally exported. Never another user's data - the
  isolation is enforced server-side by `api/dashboard.js` filtering every
  query by the caller's `user_id`, not just by hiding fields client-side
  (see `tests/integration/dashboard.integration.test.js`).

Both branches open with a time-of-day greeting
(`docs/backend/authentication.md`'s "Good morning/afternoon/evening,
{first_name}" - falling back to no name for accounts created before names
were required, e.g. a seeded admin, rather than showing a placeholder).

## Registration UX

`POST /api/auth/register` requires `first_name`/`last_name` in addition to
email/password specifically so the Dashboard can greet the person by name
- these are display-only fields, never used for authentication. The
register screen mirrors the login screen's layout (same `.auth-card`
pattern) and is reachable via a "Register" link on the login screen; after
a successful registration the same re-check-from-server boot path used
after login runs (`bootFromExistingToken`), so there's exactly one code
path that decides "show the dashboard or not," never two that could drift
apart.

## Auth flow (client side)

1. `POST /api/auth/login` -> JWT stored in `localStorage`.
2. If the response's `must_change_password` is `true`, the change-password
   screen is shown and cannot be dismissed until `POST
   /api/auth/change-password` succeeds - see `docs/diagrams/07-authentication-flow.md`.
3. Every subsequent request goes through `api.js`, which attaches the
   bearer token; a `401` anywhere clears the stored token and routes back
   to the login screen (handles both expiry and a revoked/deleted admin
   account).

**Documented limitation:** the JWT lives in `localStorage`, which is
readable by any script on the page (XSS exposure) - a pragmatic choice for
this project's academic scope, not something to carry into a production
deployment without hardening (e.g. an httpOnly cookie, which would require
backend changes beyond this project's scope). See
`docs/limitations/security-limitations.md`.

## Device registration UX

Registering a device (`POST /api/devices`) returns the plaintext device
token exactly once. The modal that shows it makes this explicit ("Copy
this token now - it cannot be retrieved again") with a copy-to-clipboard
button, and names the three real ways to get that token into the firmware
(WiFiManager portal, serial `set` command, or a remote `set_config` push -
all documented in `docs/firmware/behavior.md`).

## What is intentionally not built

No automated frontend tests exist yet - see `tests/frontend/README.md` for
why, and what manual verification currently substitutes for it.
