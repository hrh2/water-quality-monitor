# Error Handling

Two complementary mechanisms handle errors in the backend: a generic HTTP
wrapper (`api/_lib/http.js::withErrorHandling`) for REST routes, and a
typed error class (`api/_lib/ingest.js::IngestError`) for the one pipeline
that needs specific status codes for expected rejections.

## 1. `withErrorHandling` (api/_lib/http.js)

Every exported REST route handler in `api/*.js` is wrapped with
`withErrorHandling(handler)`. It:

1. Runs the handler inside a `try`/`catch`.
2. On any thrown exception, logs the full error server-side
   (`console.error(err)`), and best-effort inserts a row into
   `system_events` (`event_type: 'unhandled_error'`, `message: err.message`,
   `metadata: {stack: err.stack, path: req.url}`) so admins can see it on
   the dashboard's "System" tab (surfaced via `GET /api/dashboard`'s
   `recent_system_events`).
3. Responds to the client with a flat, generic
   `500 {"error": "Internal server error"}` - **no stack trace, message
   text, or internal detail is ever sent to the client.** This directly
   implements the project's "no internal errors exposed to users"
   principle.
4. If even the `system_events` insert fails (e.g. the database itself is
   unreachable), that secondary failure is caught and logged separately
   (`console.error('Failed to record system_event for error:', logErr)`)
   without crashing the response - the client still gets the generic 500.

This means a route handler can simply `throw` on any truly unexpected
condition and rely on `withErrorHandling` to produce a safe response; it
does not need its own top-level `try`/`catch` for that class of failure.

## 2. `IngestError` (api/_lib/ingest.js)

The reading-ingestion pipeline (`ingestReading()`) needs to distinguish
several **expected** rejection reasons with different HTTP status codes -
these are not "errors" in the unhandled-exception sense, they're normal
control flow for bad input:

```js
export class IngestError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}
```

| Condition | Status | Message pattern |
|---|---|---|
| Payload fails `validateReadingPayload` | 400 | `Invalid reading payload: <joined errors>` |
| `device_id` not found in `devices` | 404 | `Unknown device_id: <id>. Register it first via POST /api/devices.` |
| Device `is_active = false` | 403 | `Device <id> is deactivated.` |
| Token doesn't match `device_token_hash` | 401 | `Invalid device token.` |

Both call sites handle `IngestError` explicitly rather than letting it fall
through to the generic 500:

- **`api/readings.js`** (`POST`): catches `IngestError` and responds with
  its own `statusCode`/`message`; anything else is re-thrown (and caught by
  `withErrorHandling` as an unexpected 500).
- **`api/ws.js`**: has no HTTP response to send back over a WebSocket
  message, so it instead records the rejection to `system_events`
  (`event_type: 'reading_rejected'` for an `IngestError`, or
  `'reading_ingest_error'` for anything else, the latter also including
  `err.stack` in `metadata`) and drops the message - the device is not
  told its reading was rejected in-band; an operator would see it in the
  system events log.

## 3. Why this split exists

`withErrorHandling` alone would turn every rejected reading (a routine,
expected occurrence - bad token, unregistered device) into an
indistinguishable generic 500, which is both unhelpful to callers (they
can't tell "retry with a new token" from "the server is broken") and noisy
in the error log. `IngestError` carries enough structure for the two real
call sites to respond appropriately, while unexpected bugs still fall
through to the same safe, logged, generic-500 path as every other route.
