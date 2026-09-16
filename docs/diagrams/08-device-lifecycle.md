# Diagram 08: Device Lifecycle

From admin registration through to a device being marked offline, covering
the real endpoints and firmware behavior involved.

```mermaid
flowchart TD
    A[Admin: POST /api/devices\n{device_id, label?, firmware_version?}] --> B[api/devices/index.js\ngenerate 24-byte random token,\nbcrypt-hash it]
    B --> C[INSERT devices\ndevice_token_hash stored;\nplaintext token returned ONCE\nin the 201 response]
    C --> D{How is the device configured?}
    D -->|First boot, no config| E[WiFiManager captive portal\nAP: WaterQualityMonitor-Setup]
    D -->|Serial access| F[Serial commands:\nshow / config / reset /\nset field=value]
    D -->|Already connected| G[Remote set_config over WS\n{cmd: set_config, device_id, device_token, ...}]
    E --> H[Config saved to LittleFS\n/config.json]
    F --> H
    G --> H
    H --> I[Firmware connects to\napi/ws.js and starts publishing]
    I --> J[ingestReading authenticates\ntoken against device_token_hash]
    J --> K[UPDATE devices.last_seen_at = now()\non every accepted reading]
    K --> L{deriveDeviceStatus\napi/_lib/devices.js}
    L -->|now - last_seen_at <= 90s| M[Online]
    L -->|older, no recent ws error| N[Offline]
    L -->|older, recent device_ws_error event| O[Connection error]
    L -->|last_seen_at is null| P[Never connected]
```

Notes:

- The plaintext device token is shown **exactly once**, in the
  `POST /api/devices` response body (`device_token`), with an explicit
  warning that it cannot be retrieved again - only its bcrypt hash is
  persisted (`devices.device_token_hash`).
- Device status is never a stored column; `deriveDeviceStatus` computes it
  from `last_seen_at` on every read (`GET /api/devices`,
  `GET /api/devices/:deviceId`, `GET /api/system/health`), using
  `ONLINE_THRESHOLD_MS = 90_000` - chosen as one full WiFi-reconnect
  backoff cycle (capped at 60s) of slack beyond the firmware's 3-second
  read interval.
- Remote `set_config` is authenticated only by virtue of arriving over an
  already-open, token-validated WebSocket connection - the firmware's own
  comments flag this as a hijack risk if the server ever authorized a
  connection without checking the current device token first. See
  `docs/firmware/behavior.md` and
  `docs/limitations/security-limitations.md`.
