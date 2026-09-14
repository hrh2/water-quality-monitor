# Water Quality Monitor

Reads pH (RS485/Modbus), Turbidity, and TDS (both via ADS1115) on an
ESP8266, and streams live readings over WebSocket to a Vercel-hosted
server + dashboard.

## 1. Deploy the server

```
cd server
npm install
npx vercel deploy --prod
```

Vercel will give you a URL like `water-quality-monitor.vercel.app`.
Open it in a browser - you'll see the dashboard, showing "waiting for
device..." until the ESP8266 starts publishing.

Before deploying, open `api/ws.js` and change `DEVICE_TOKEN` to your
own private value.

## 2. Configure and flash the firmware

Open `firmware/water_quality_monitor.ino` in the Arduino IDE and set:

- `WIFI_SSID` / `WIFI_PASSWORD` - your network credentials
- `WS_HOST` - your Vercel domain, e.g. `water-quality-monitor.vercel.app`
- `DEVICE_TOKEN` - must match the value you set in `api/ws.js`

Install these libraries via Library Manager before compiling:
- ModbusMaster (Doc Walker)
- Adafruit ADS1X15
- WebSockets (Markus Sattler / arduinoWebSockets)
- ArduinoJson

Wiring (matches what we confirmed works during setup):
- MAX485 DI -> D7 / GPIO13, RO -> D6 / GPIO12, DE+RE -> D5 / GPIO14
- ADS1115 SDA -> D2 / GPIO4, SCL -> D1 / GPIO5
- Turbidity sensor output -> ADS1115 A0
- TDS sensor output -> ADS1115 A1

Flash it, open the Serial Monitor at 115200 baud, and confirm you see
`WebSocket connected` and a stream of `Published: {...}` lines.

## 3. What's included vs. what's not yet

Included and working: pH, Turbidity, TDS.

Not included: Moisture, Temperature, EC, NPK. During setup we
confirmed the sensor responds on Modbus holding registers, but never
found the correct addresses for these four values - the addresses the
generic "7-in-1" register map assumes (0x00-0x03, 0x1E-0x20) return
"Illegal Data Address" on this specific sensor. Once those are mapped
(see the `liveWatch()` scanning tool from earlier in this project),
they can be added to both the firmware's `publishReading()` payload
and the dashboard.

## 4. Notes on accuracy

- **pH** uses register `0x06 / 100`. This produced a stable 7.00
  reading in testing (plausible for neutral pH) but was never checked
  against a real pH buffer solution - verify before trusting readings.
- **Turbidity** and **TDS** use common published calibration curves for
  generic analog sensor modules. These are a reasonable starting point
  but will drift from your specific sensor's actual behavior -
  calibrate against known references (distilled water, a TDS reference
  solution) and adjust the coefficients in the firmware if needed.

## 5. On Vercel + WebSockets

Vercel added native WebSocket support in public beta (June 2026). A
few things worth knowing:
- Connections are pinned to one Function instance for the life of the
  connection, and get cut when that instance's max duration is hit -
  the firmware and dashboard both auto-reconnect to handle this.
- State (like `lastReading`) lives in that single instance's memory,
  not shared across instances - fine for one device and a few
  dashboard viewers, but not something to scale up without adding
  Redis or a similar external store.
