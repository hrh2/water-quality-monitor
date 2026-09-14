// =====================================================================
// Water Quality Monitor - ESP8266 firmware
//
// Reads:
//   - pH        via RS485 Modbus sensor  (register 0x06, holding reg)
//   - Turbidity via ADS1115 channel A0
//   - TDS       via ADS1115 channel A1
//
// Publishes all readings as JSON over WebSocket to a server (e.g. the
// Vercel WebSocket function in server/api/ws.js in this project).
//
// Libraries needed (Arduino Library Manager):
//   - ModbusMaster        by Doc Walker
//   - Adafruit ADS1X15    by Adafruit
//   - WebSockets          by Markus Sattler (arduinoWebSockets)
//   - ArduinoJson         by Benoit Blanchon
// =====================================================================

#include <ESP8266WiFi.h>
#include <SoftwareSerial.h>
#include <Wire.h>
#include <ModbusMaster.h>
#include <Adafruit_ADS1X15.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ---------------------- WiFi credentials ----------------------------
const char* WIFI_SSID     = "canalbox-2G";
const char* WIFI_PASSWORD = "12345678910";

// ---------------------- WebSocket server -----------------------------
// Point this at your deployed Vercel app. Use "wss" + port 443 for a
// production Vercel deployment (TLS is handled by Vercel automatically).
const char* WS_HOST = "water-quality-monitor-two.vercel.app";
const uint16_t WS_PORT = 443;
const char* WS_PATH = "/api/ws";
const bool WS_USE_TLS = true;

// A simple shared token so your server can reject readings that don't
// come from your own device. Change this to something private.
const char* DEVICE_TOKEN = "change-me-device-token";
const char* DEVICE_ID = "soil-water-monitor-1";

// ---------------------- RS485 / Modbus pH sensor ----------------------
#define RS485_DIR_PIN  14   // D5 / GPIO14  (MAX485 DE+RE tied together)
#define RS485_RX_PIN   12   // D6 / GPIO12  (MAX485 RO -> ESP RX)
#define RS485_TX_PIN   13   // D7 / GPIO13  (MAX485 DI <- ESP TX)
#define MODBUS_SLAVE_ID 1
#define PH_REGISTER    0x0006

// Divide the raw register value by this to get pH.
// Confirmed stable at 700 in testing; 700/100 = 7.00 is the working
// assumption. Verify against a pH 7 buffer solution and adjust if needed.
#define PH_DIVISOR     100.0

SoftwareSerial rs485Serial(RS485_RX_PIN, RS485_TX_PIN);
ModbusMaster node;

void preTransmission()  { digitalWrite(RS485_DIR_PIN, HIGH); delayMicroseconds(500); }
void postTransmission() { delayMicroseconds(500); digitalWrite(RS485_DIR_PIN, LOW); }

// ---------------------- ADS1115 (Turbidity + TDS) ----------------------
Adafruit_ADS1115 ads;

// ADS1115 gain of 1 => +/-4.096V full scale, matches 0-3.3V analog
// sensor outputs with headroom. Adjust GAIN + these constants if your
// sensor modules output a different voltage range.
#define ADS_FULLSCALE_VOLTS  4.096
#define ADS_MAX_COUNTS       32767.0

#define TURBIDITY_CHANNEL  0   // A0
#define TDS_CHANNEL        1   // A1

// TDS sensor board usually needs the water temperature to compensate.
// Without a working temperature probe right now, we use a fixed
// assumed temperature. Replace this with a real reading once you have
// a working temperature sensor.
#define ASSUMED_WATER_TEMP_C  25.0

// ---------------------- Timing ----------------------
const unsigned long READ_INTERVAL_MS = 3000;
unsigned long lastReadMs = 0;

WebSocketsClient webSocket;
bool wsConnected = false;

// =====================================================================
// Sensor reading helpers
// =====================================================================

// Returns true on success, writes pH into *outPh.
bool readPH(float *outPh) {
  uint8_t result = node.readHoldingRegisters(PH_REGISTER, 1);
  if (result != node.ku8MBSuccess) {
    return false;
  }
  uint16_t raw = node.getResponseBuffer(0);
  *outPh = raw / PH_DIVISOR;
  return true;
}

// Converts an ADS1115 raw reading to volts.
float countsToVolts(int16_t counts) {
  return (counts * ADS_FULLSCALE_VOLTS) / ADS_MAX_COUNTS;
}

// Approximate NTU conversion for common analog turbidity sensor
// modules (e.g. DFRobot-style, 5V supply, 0-4.5V output). This is a
// commonly used calibration curve as a *starting point* - for accurate
// readings, calibrate against known NTU standards (e.g. distilled
// water = ~0 NTU) and adjust the coefficients.
float voltageToNTU(float voltage) {
  if (voltage < 0) voltage = 0;
  float ntu = -1120.4 * voltage * voltage + 5742.3 * voltage - 4352.9;
  if (ntu < 0) ntu = 0;
  return ntu;
}

// Approximate TDS (ppm) conversion for common analog TDS sensor
// modules, temperature-compensated. This is a widely used starting
// formula (DFRobot-style Gravity TDS sensors) - calibrate against a
// known TDS reference solution for accurate readings.
float voltageToTDS(float voltage, float tempC) {
  if (voltage < 0) voltage = 0;
  float compensationCoefficient = 1.0 + 0.02 * (tempC - 25.0);
  float compensatedVoltage = voltage / compensationCoefficient;
  float tds = (133.42 * pow(compensatedVoltage, 3)
             - 255.86 * pow(compensatedVoltage, 2)
             + 857.39 * compensatedVoltage) * 0.5;
  if (tds < 0) tds = 0;
  return tds;
}

// =====================================================================
// WiFi + WebSocket
// =====================================================================

void connectWiFi() {
  Serial.print("Connecting to WiFi: ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
    // Don't block forever - if WiFi doesn't come up in 20s, restart
    // the attempt. The main loop will keep retrying.
    if (millis() - start > 20000) {
      Serial.println("\nWiFi connect timed out, retrying...");
      WiFi.disconnect();
      delay(500);
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      start = millis();
    }
  }
  Serial.println("\nWiFi connected. IP: " + WiFi.localIP().toString());
}

void onWsEvent(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      wsConnected = false;
      Serial.println("WebSocket disconnected");
      break;
    case WStype_CONNECTED:
      wsConnected = true;
      Serial.println("WebSocket connected");
      break;
    case WStype_TEXT:
      // Server could send config/commands here in the future.
      break;
    case WStype_ERROR:
      Serial.println("WebSocket error");
      break;
    default:
      break;
  }
}

void connectWebSocket() {
  if (WS_USE_TLS) {
    webSocket.beginSSL(WS_HOST, WS_PORT, WS_PATH);
  } else {
    webSocket.begin(WS_HOST, WS_PORT, WS_PATH);
  }
  webSocket.onEvent(onWsEvent);
  webSocket.setReconnectInterval(5000);
  // Keep the connection alive - helps detect a dead socket quickly.
  webSocket.enableHeartbeat(15000, 3000, 2);
}

// =====================================================================
// Setup / Loop
// =====================================================================

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n--- Water Quality Monitor booting ---");

  // RS485 / Modbus pH sensor
  pinMode(RS485_DIR_PIN, OUTPUT);
  digitalWrite(RS485_DIR_PIN, LOW);
  rs485Serial.begin(9600);
  node.begin(MODBUS_SLAVE_ID, rs485Serial);
  node.preTransmission(preTransmission);
  node.postTransmission(postTransmission);

  // ADS1115 (Turbidity + TDS), I2C on D2/D1 (default ESP8266 pins)
  Wire.begin(4, 5); // SDA=D2/GPIO4, SCL=D1/GPIO5
  if (!ads.begin()) {
    Serial.println("Failed to initialize ADS1115 - check wiring!");
  }
  ads.setGain(GAIN_ONE); // +/-4.096V range

  connectWiFi();
  connectWebSocket();

  Serial.println("--- Setup complete ---\n");
}

void publishReading(bool phOk, float ph, float turbidityNTU, float tdsPPM) {
  StaticJsonDocument<256> doc;
  doc["device_id"] = DEVICE_ID;
  doc["token"] = DEVICE_TOKEN;
  doc["ts"] = millis();

  if (phOk) {
    doc["ph"] = ph;
  } else {
    doc["ph"] = nullptr;
  }
  doc["turbidity_ntu"] = turbidityNTU;
  doc["tds_ppm"] = tdsPPM;

  char buffer[256];
  size_t len = serializeJson(doc, buffer);

  if (wsConnected) {
    webSocket.sendTXT(buffer, len);
  }

  Serial.print("Published: ");
  Serial.println(buffer);
}

void loop() {
  // Keep WiFi alive
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  // WebSocket needs frequent servicing to handle reconnects/heartbeats
  webSocket.loop();

  unsigned long now = millis();
  if (now - lastReadMs >= READ_INTERVAL_MS) {
    lastReadMs = now;

    float ph = 0;
    bool phOk = readPH(&ph);

    int16_t rawTurbidity = ads.readADC_SingleEnded(TURBIDITY_CHANNEL);
    int16_t rawTds       = ads.readADC_SingleEnded(TDS_CHANNEL);

    float turbidityVolts = countsToVolts(rawTurbidity);
    float tdsVolts        = countsToVolts(rawTds);

    float turbidityNTU = voltageToNTU(turbidityVolts);
    float tdsPPM = voltageToTDS(tdsVolts, ASSUMED_WATER_TEMP_C);

    publishReading(phOk, ph, turbidityNTU, tdsPPM);
  }
}
