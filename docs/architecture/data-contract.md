# Data Contract (Single Source of Truth)

This document is the canonical definition of every field name used anywhere in
the system: firmware, WebSocket wire protocol, database schema, ML dataset,
prediction API, and dashboard. **If a field changes, it must change in every
layer listed below, and this file must be updated first.**

## 1. Sensor features (from `firmware/firmware.ino`)

The device has exactly three real sensor inputs. There is no temperature
sensor and no dissolved-oxygen sensor installed, despite the project abstract
mentioning them as aspirational parameters — `ASSUMED_WATER_TEMP_C` is a
hardcoded constant used only internally to compensate the TDS calibration
curve; it is never measured or transmitted.

| Field            | Type            | Unit | Source                              | Notes |
|------------------|-----------------|------|--------------------------------------|-------|
| `ph`              | float or `null` | pH   | RS485/Modbus pH probe (register `0x06`) | `null` when the Modbus read fails (`phOk == false`); never omit the key |
| `turbidity_ntu`   | float           | NTU  | ADS1115 channel A0, polynomial calibration curve | Always present; sensor never fails to produce *a* voltage, only produces implausible ones |
| `tds_ppm`         | float           | ppm  | ADS1115 channel A1, cubic calibration curve, temperature-compensated using the assumed 25°C constant | Always present |

These three names (`ph`, `turbidity_ntu`, `tds_ppm`) are used **verbatim** in:
firmware JSON payload → WebSocket relay → database columns → ML dataset
columns → ML feature vector → prediction API request/response → frontend
JS variables. No renaming (e.g. `temp_celsius` vs `temperatureValue`) is
permitted at any layer.

## 2. Device/message envelope fields

| Field           | Type   | Meaning |
|-----------------|--------|---------|
| `device_id`      | string | Firmware-configured device identifier (default `soil-water-monitor-1`), set via WiFiManager portal, serial `set` command, or remote `set_config` |
| `token`          | string | Shared-secret device auth token, compared against `DEVICE_TOKEN`/DB-stored per-device token |
| `ts`             | integer | Device-side `millis()` value at read time — **milliseconds since device boot, NOT wall-clock time**. Never treat as an epoch timestamp. |
| `received_at`    | integer (epoch ms) | Server-assigned wall-clock timestamp, added by the backend when a reading is accepted. **This is the canonical timestamp used everywhere downstream** (database, charts, "last seen"). |

This `ts` vs `received_at` distinction matters and is a documented limitation:
the device has no RTC, so it cannot report real time on its own; the server
clock is authoritative.

## 3. Derived / ML fields

| Field                    | Type   | Meaning |
|--------------------------|--------|---------|
| `water_quality_category`  | enum: `Safe` \| `Moderate` \| `Unsafe` \| `Critical` | ML-predicted class, see `docs/machine-learning/target-methodology.md` |
| `prediction_confidence`   | float 0–1 | Predicted class probability from the model, when the algorithm supports `predict_proba` |
| `contamination_risk`      | boolean | Rule/statistical anomaly flag, independent of the ML classifier — see `docs/machine-learning/contamination-detection.md` |

**Terminology rule:** the system never claims to detect a specific pathogen,
chemical, or to certify potability. Output language is always
"predicted water-quality category" / "potential contamination risk", never
"contaminated" or "safe to drink" as a certification.

## 4. Full example wire message (device → server)

```json
{
  "device_id": "soil-water-monitor-1",
  "token": "change-me-device-token",
  "ts": 1583421,
  "ph": 7.12,
  "turbidity_ntu": 3.4,
  "tds_ppm": 214.6
}
```

## 5. Full example server → dashboard broadcast

```json
{
  "device_id": "soil-water-monitor-1",
  "ts": 1583421,
  "received_at": 1771200000000,
  "ph": 7.12,
  "turbidity_ntu": 3.4,
  "tds_ppm": 214.6,
  "water_quality_category": "Safe",
  "prediction_confidence": 0.87,
  "contamination_risk": false
}
```
