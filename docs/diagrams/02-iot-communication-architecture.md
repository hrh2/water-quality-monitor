# Diagram 02: IoT Communication Architecture

Covers the real communication path between the sensor rig and the backend,
including the firmware's offline ring-buffer and reconnect behavior
(`firmware/firmware.ino`), which is easy to omit from a simplified diagram
but is a real, implemented part of the system's resilience story.

```mermaid
sequenceDiagram
    participant Sensors as pH probe / ADS1115
    participant FW as ESP8266 Firmware
    participant Buf as RAM ring buffer (20 readings)
    participant WS as api/ws.js (Vercel)
    participant DB as Postgres

    loop every READ_INTERVAL_MS (3000ms)
        Sensors->>FW: raw pH register, ADC counts (A0, A1)
        FW->>FW: voltageToNTU() / voltageToTDS()\ncalibration curves
        alt WebSocket connected
            FW->>WS: JSON {device_id, token, ts, ph, turbidity_ntu, tds_ppm}
            WS->>DB: ingestReading() persists + predicts + alerts
        else WebSocket down
            FW->>Buf: bufferReading() (oldest overwritten if full)
        end
    end

    Note over FW,WS: WiFi or WS outage: FW retries WS every 5s\n(WebSocketsClient.setReconnectInterval),\nWiFi reconnect uses capped exponential backoff\n(5s to 60s) tracked in loop()

    WS-->>FW: onWsEvent(WStype_CONNECTED)
    FW->>Buf: flushBufferedReadings() - oldest first
    Buf->>WS: buffered JSON readings, in order
    WS->>DB: ingestReading() for each flushed reading

    Note over FW: Boot-time WiFi failure: RTC-memory-tracked\nretry counter (WIFI_MAX_BOOT_RETRIES=5);\nafter repeated failures, opens the\nWiFiManager setup AP for manual reconfiguration
```

Key real behaviors reflected here (all from `firmware/firmware.ino`):

- Readings are never silently dropped during a short outage - they are
  buffered (`READING_BUFFER_SIZE = 20`) and flushed in original order once
  the WebSocket reconnects, oldest overwritten first if the buffer fills.
- The device's own `ts` field is `millis()` (time since boot), not
  wall-clock time - the server assigns the authoritative `received_at` on
  arrival. See `docs/architecture/data-contract.md` §2.
- The server can also push configuration to the device over the same open
  WebSocket connection (`cmd: "set_config"`) - see
  `docs/diagrams/08-device-lifecycle.md` and
  `docs/firmware/behavior.md` for the associated security caveat.
