# Chapter 6: Hardware and IoT

The physical build is an ESP8266 microcontroller wired to two sensor
interfaces: an RS485/Modbus pH probe (read via a MAX485 transceiver at
holding register `0x06`) and an ADS1115 16-bit ADC reading two analog
sensors - turbidity on channel A0, TDS on channel A1. The full pin mapping,
calibration formulas, and their documented caveats are in
`docs/hardware/sensors-and-wiring.md`; they are not repeated here.

A point worth stating plainly in this chapter, because it is easy to
misrepresent in a project abstract: **this hardware measures exactly three
parameters.** There is no temperature sensor and no dissolved-oxygen
sensor installed. A constant in the firmware, `ASSUMED_WATER_TEMP_C`,
exists purely to compensate the TDS calibration curve's known temperature
sensitivity - it is never measured by a sensor and never transmitted
anywhere in the system. Any book chapter or abstract describing this
project's sensing capability should reflect exactly this, not the
aspirational four-or-more-parameter description found in an earlier
project abstract draft.

The IoT communication layer - a persistent WebSocket connection with
offline ring-buffering and capped-exponential-backoff reconnect logic - is
covered in Chapter 7 (firmware) and diagrammed in
`docs/diagrams/02-iot-communication-architecture.md`; this chapter focuses
on the physical sensing side only.

## Outline

- Sensor inventory and interface types (Modbus/RS485 vs. I2C ADC)
- Full wiring diagram reference (`docs/hardware/sensors-and-wiring.md`)
- Calibration curve formulas as implemented, and their honest
  not-yet-calibrated-per-device status
- What this hardware does not measure, and why that matters for later
  chapters on ML limitations (Chapter 19)
- Sensors probed for but never successfully mapped (moisture, EC, NPK -
  see `docs/hardware/sensors-and-wiring.md` §6)
