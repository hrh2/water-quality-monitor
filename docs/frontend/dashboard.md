# Frontend

Two static, framework-free HTML pages, served directly by Vercel (no build
step - matches the project's "prefer simple, already-Vercel-compatible"
principle):

| Page | Audience | Purpose |
|---|---|---|
| `index.html` (URL `/index.html` and `/`) | Public | Live single-device readout over the `/api/ws` WebSocket, unauthenticated (as it always was in the original project) |
| `admin.html` (URL `/admin.html`) | Admin (JWT-authenticated) | Full operations dashboard - the 7 sections below |

Both pages live under `public/` on disk (`public/index.html`,
`public/admin.html`), not the repository root - Vercel's static-file
convention serves everything under a top-level `public/` directory as the
site root (the `public` segment itself is stripped from the URL), so this
is where they have to live for `/index.html` and `/admin.html` to resolve
in production. See `docs/deployment/vercel.md`.

## Admin console architecture

```
public/admin.html                # shells: login screen, forced change-password screen, app shell with 7 <section id="tab-*"> containers
public/css/admin.css            # extends index.html's CSS variables (--bg/--panel/--line/--text/--text-dim/--accent/--warn/--danger), adds a light theme via [data-theme="light"]
public/js/api.js                # fetch wrapper: attaches `Authorization: Bearer <token>`, centralizes 401 -> logout handling, distinguishes ApiError (has .status) vs NetworkError
public/js/utils.js              # relative-time/date formatting, category/severity/status badge HTML, shared loading/error/empty state renderer
public/js/charts.js             # thin Chart.js wrapper (line, doughnut, bar), each chart's container uses CSS `min-width: 0` inside `.grid-2`/`.grid-3` so Chart.js's responsive resize doesn't push a row past the viewport
public/js/auth-screens.js       # login form + the non-skippable forced password-change form
public/js/app.js                # boot sequence, tab routing, theme toggle, a single shared /api/ws connection (view-only, for the topbar live/disconnected indicator), logout, global 401 -> login redirect
public/js/sections/*.js         # one module per tab: overview, sensors, waterquality, alerts, devices, ml, system
```

Every section module fetches its own data on activation (no polling loop),
renders one of: a loading state, a real empty state (e.g. "no devices
registered yet" when `devices.total === 0`), a real error state (network
failure or non-2xx response - never a blank panel), or the populated view.
No section ever fabricates placeholder data to "look populated."

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
