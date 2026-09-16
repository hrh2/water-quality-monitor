# Sensors and Wiring

This document transcribes the real wiring and calibration formulas from
`firmware/firmware.ino`, carried forward from the original project README's
honest calibration caveats.

## 1. Sensor inventory

The device has **exactly three** real sensor inputs. There is no
temperature sensor and no dissolved-oxygen sensor installed, despite the
project abstract mentioning such parameters aspirationally. See
`docs/architecture/data-contract.md` §1 for the canonical field mapping.

| Sensor | Interface | Firmware constant | Field produced |
|---|---|---|---|
| pH probe | RS485/Modbus, holding register `0x06` | `PH_REGISTER 0x0006`, `PH_DIVISOR 100.0` | `ph` (nullable) |
| Turbidity sensor | Analog, via ADS1115 ADC | `TURBIDITY_CHANNEL 0` (A0) | `turbidity_ntu` |
| TDS sensor | Analog, via ADS1115 ADC | `TDS_CHANNEL 1` (A1) | `tds_ppm` |

## 2. Wiring

### RS485 / Modbus pH sensor (MAX485 transceiver)

| MAX485 pin | ESP8266 pin | Firmware constant |
|---|---|---|
| DI (data in) | D7 / GPIO13 | `RS485_TX_PIN 13` |
| RO (receive out) | D6 / GPIO12 | `RS485_RX_PIN 12` |
| DE + RE (tied together) | D5 / GPIO14 | `RS485_DIR_PIN 14` |

Communication is over a `SoftwareSerial` instance (`rs485Serial`) at 9600
baud, Modbus slave ID `1` (`MODBUS_SLAVE_ID`), using the `ModbusMaster`
library. `preTransmission()`/`postTransmission()` toggle the DE/RE pin with
a 500µs guard delay around each transmission.

### ADS1115 (turbidity + TDS), I2C

| ADS1115 pin | ESP8266 pin |
|---|---|
| SDA | D2 / GPIO4 |
| SCL | D1 / GPIO5 |

Set up via `Wire.begin(4, 5)` and `ads.setGain(GAIN_ONE)`, giving a full-scale
range of `ADS_FULLSCALE_VOLTS = 4.096V` over `ADS_MAX_COUNTS = 32767` counts.

- Turbidity sensor output -> ADS1115 **A0**
- TDS sensor output -> ADS1115 **A1**

## 3. Calibration formulas (as implemented)

### Counts to volts

```
voltage = (counts * 4.096) / 32767
```

### Turbidity: voltage -> NTU (`voltageToNTU`)

```
ntu = -1120.4 * v^2 + 5742.3 * v - 4352.9   (clamped to >= 0)
```

### TDS: voltage -> ppm (`voltageToTDS`), temperature-compensated

```
compensationCoefficient = 1.0 + 0.02 * (tempC - 25.0)
compensatedVoltage = v / compensationCoefficient
tds = (133.42*cv^3 - 255.86*cv^2 + 857.39*cv) * 0.5   (clamped to >= 0)
```

`tempC` here is **`ASSUMED_WATER_TEMP_C = 25.0`**, a hardcoded constant, not
a live measurement - see §4.

### pH: register value -> pH

```
ph = raw_register_value / 100.0
```

## 4. On the temperature constant - what it is and is not

`ASSUMED_WATER_TEMP_C` exists **only** to compensate the TDS calibration
curve's temperature sensitivity term above. It is:

- **not** measured by any installed sensor,
- **not** transmitted in any wire message, database column, or API field,
- **not** the same thing as a "temperature reading" the system reports
  anywhere.

The firmware's own comment on this constant is honest about its status:
`// replace once a real temp sensor works`. If a real temperature sensor is
ever added, it would need to (a) feed this compensation term with a live
value and (b) be added as an explicit new field throughout the data
contract - it is not silently already flowing through the system today.

## 5. Calibration caveats (carried forward honestly from the original README)

These calibration curves are **generic published curves for common analog
sensor modules**, not curves fitted to this specific sensor rig:

- **pH**: register `0x06 / 100` produced a stable `7.00` reading during
  initial testing (plausible for neutral pH), but this was never checked
  against a certified pH buffer solution. Verify against a pH 7 (and
  ideally pH 4/10) buffer solution before trusting absolute readings.
- **Turbidity and TDS**: the polynomial coefficients above are commonly
  published starting points for generic analog turbidity/TDS breakout
  boards, not values derived from calibrating this project's specific
  sensors against reference standards (distilled water, a certified TDS
  reference solution, a turbidity standard). Expect drift from the true
  value on this specific hardware until per-device calibration is done.

This is an explicit, carried-forward limitation, not a claim that
calibration has been completed. See
`docs/limitations/ml-limitations.md` for how this interacts with the
model's real-world validity.

## 6. Sensors present in an earlier register-scan attempt but not wired in

The original project README notes that a "7-in-1" style Modbus sensor was
probed for additional parameters (moisture, temperature, EC, NPK) at
holding registers `0x00`-`0x03` and `0x1E`-`0x20`, but those addresses
returned a Modbus "Illegal Data Address" response on this specific sensor
and were never successfully mapped. None of those parameters are read,
stored, or transmitted anywhere in the current firmware or backend - only
`ph`, `turbidity_ntu`, and `tds_ppm` exist end to end.
