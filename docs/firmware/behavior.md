# Firmware Behavior

This document covers the ESP8266 firmware's (`firmware/firmware.ino`)
runtime behavior: configuration, offline resilience, and its data contract.
For wiring and calibration formulas, see
`docs/hardware/sensors-and-wiring.md`. For the exact wire field names, see
`docs/architecture/data-contract.md` - fields are not redefined here.

## 1. Configuration system

The firmware supports three independent ways to set/change its
configuration (WiFi credentials, `ws_host`, `ws_port`, `ws_path`, `ws_tls`,
`device_id`, `device_token`), all persisted to `/config.json` on LittleFS
via `saveConfig()`/`loadConfig()`:

### a. WiFiManager captive portal

On first boot (no saved config), or after repeated WiFi failures, the
device opens a WiFi access point named `WaterQualityMonitor-Setup`.
Connecting to it opens a captive portal page with fields for WiFi
credentials plus the custom parameters (`ws_host`, `ws_port`, `ws_path`,
`device_id`, `device_token`) added via `WiFiManagerParameter` in
`runConfigPortal()`. Submitting the form calls `saveConfig()` and reboots
into normal operation. The portal is time-bounded
(`WIFI_CONFIG_PORTAL_TIMEOUT_S = 120` on a normal boot re-check,
`300` seconds when explicitly forced open) rather than blocking forever.

### b. Serial commands

Typed into the Arduino Serial Monitor at 115200 baud
(`handleSerialCommand()`):

| Command | Effect |
|---|---|
| `show` | Prints the current configuration (`printConfig()`) |
| `config` | Re-opens the WiFiManager portal to change WiFi + server settings interactively |
| `reset` | Erases `/config.json` and WiFi credentials (`wm.resetSettings()`), then restarts into the setup AP |
| `set <field>=<value>` | Sets one field directly (`ws_host`, `ws_port`, `ws_path`, `ws_tls`, `device_id`, `device_token`), saves, and reconnects the WebSocket with the new value |

### c. Remote `set_config` over an open WebSocket connection

The server can push a configuration update to an already-connected device
by sending a JSON text frame:

```json
{"cmd": "set_config", "device_id": "...", "device_token": "..."}
```

Any subset of `device_id`, `device_token`, `ws_host`, `ws_port`, `ws_path`,
`ws_tls` may be included; only fields present are changed
(`handleRemoteSetConfig()`). The device saves to flash and replies with a
`config_ack` message. If `ws_host`/`ws_port`/`ws_path`/`ws_tls` changed, the
socket is disconnected and reconnected with the new target; if only
`device_id`/`device_token` changed, the existing connection is left open
and the new values are used on the next published reading.

**Security caveat, quoted faithfully from the firmware's own comments:**

> since this arrives authenticated only by an already-open WS connection,
> make sure your server only opens/authorizes that connection using the
> current valid device_token before sending a set_config message -
> otherwise anyone able to reach your WS endpoint could hijack a device's
> identity.

This is a real, documented limitation of the current design, not
speculation - see `docs/limitations/security-limitations.md` for how this
interacts with the rest of the system's auth model.

## 2. WiFi resilience (unattended operation)

- **Boot-time outage**: the initial `autoConnect()` is bounded by
  `WIFI_CONFIG_PORTAL_TIMEOUT_S`. If the saved network can't be reached in
  that window, the device restarts and retries, up to
  `WIFI_MAX_BOOT_RETRIES = 5` times. The retry count is stored in **RTC
  user memory** (`RtcRetryData`, tagged with `RTC_RETRY_MAGIC`), which
  survives `ESP.restart()` (a warm reboot) but resets on power loss - a
  deliberate choice, since power loss is itself a fresh start worth
  retrying from scratch. After exhausting retries, the device opens the
  setup AP for manual reconfiguration instead of continuing to fail
  silently.
- **Mid-run outage**: `loop()` detects `WiFi.status() != WL_CONNECTED`,
  and retries with a **capped exponential backoff**: starts at
  `WIFI_RECONNECT_MIN_INTERVAL_MS = 5000`, doubles each failed attempt, and
  caps at `WIFI_RECONNECT_MAX_INTERVAL_MS = 60000`. Status is logged at
  most every `WIFI_STATUS_LOG_INTERVAL_MS = 30000` to avoid spamming the
  serial console during a long outage.

## 3. Offline reading buffer

While the WebSocket is disconnected, `publishReading()` calls
`bufferReading()` instead of sending immediately. This writes into a
fixed-size ring buffer (`READING_BUFFER_SIZE = 20`); once full, the oldest
buffered reading is silently overwritten (logged: "Reading buffer full -
oldest buffered reading dropped."). On reconnect
(`WStype_CONNECTED` in `onWsEvent`), `flushBufferedReadings()` sends every
buffered reading **in original order**, oldest first, then clears the
buffer. This means a brief outage does not silently lose data, but a
sufficiently long outage (more than 20 readings, i.e. more than 60 seconds
at the 3-second read interval) does lose the oldest readings beyond the
buffer's capacity.

## 4. Data contract sent by the firmware

The firmware sends and receives exactly the fields defined in
`docs/architecture/data-contract.md` - this document does not redefine
them. In short: outbound readings carry `device_id`, `token`, `ts`
(`millis()`, not wall-clock), `ph` (`null` on Modbus failure), `turbidity_ntu`,
and `tds_ppm`; inbound `set_config` commands carry the subset of
configuration fields listed in §1c above.

## 5. Read cadence

Sensors are read and published every `READ_INTERVAL_MS = 3000` (3 seconds),
tracked against `millis()` in `loop()`. This cadence is also the basis for
`api/_lib/devices.js`'s `ONLINE_THRESHOLD_MS = 90_000` device-status
derivation - see `docs/database/schema.md`.
