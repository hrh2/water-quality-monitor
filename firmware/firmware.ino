// =====================================================================
// Water Quality Monitor - ESP8266 firmware (v2: dynamic configuration)
//
// Reads:
//   - pH        via RS485 Modbus sensor  (register 0x06, holding reg)
//   - Turbidity via ADS1115 channel A0
//   - TDS       via ADS1115 channel A1
//
// Publishes JSON readings over WebSocket to a server.
//
// CONFIGURATION (no re-flashing needed to change WiFi or server info):
//   - On first boot (or whenever config is missing/reset), the device
//     opens a WiFi Access Point called "WaterQualityMonitor-Setup".
//     Connect to it from a phone/laptop - a captive portal page opens
//     automatically letting you enter WiFi credentials AND the
//     WebSocket host/token/device id. Submitting saves everything to
//     flash (LittleFS) and reboots into normal operation.
//   - Once configured, it just connects and runs.
//   - To reconfigure later without re-flashing:
//       * Type "config" in the Serial Monitor to re-open the setup AP
//       * Or type "set <field>=<value>" to change one field directly,
//         e.g.  set ws_host=my-new-app.vercel.app
//       * Type "show" to print the current saved configuration
//       * Type "reset" to erase all saved config and reboot into the
//         setup AP
//   - The server can ALSO push a config update remotely over the same
//     WebSocket connection (no serial/physical access needed), by
//     sending a JSON text frame:
//       {"cmd":"set_config","device_id":"...","device_token":"..."}
//     Any subset of fields (device_id, device_token, ws_host, ws_port,
//     ws_path, ws_tls) may be included; only the fields present are
//     changed. The device saves to flash and re-sends a "config_ack".
//     NOTE: since this arrives authenticated only by an already-open
//     WS connection, make sure your server only opens/authorizes that
//     connection using the current valid device_token before sending
//     a set_config message - otherwise anyone able to reach your
//     WS endpoint could hijack a device's identity.
//
// WIFI RESILIENCE (unattended operation):
//   - Boot-time outage: the initial autoConnect() is bounded by a
//     timeout instead of hanging in the setup AP forever. If it can't
//     reach the saved network within that window, the device restarts
//     and tries again, up to WIFI_MAX_BOOT_RETRIES times (tracked in
//     RTC memory, survives ESP.restart() but not power loss). Only
//     after repeated failures does it fall back to opening the setup
//     AP for manual reconfiguration.
//   - Mid-run outage: loop() retries the saved network with a capped
//     exponential backoff and prints periodic status instead of
//     spamming reconnect calls every 500ms.
//   - Readings taken while the WebSocket is down are buffered in RAM
//     (ring buffer, most recent READING_BUFFER_SIZE readings) and
//     flushed to the server in order once the socket reconnects, so
//     brief outages don't silently lose data.
//
// Libraries needed (Arduino Library Manager):
//   - ModbusMaster        by Doc Walker
//   - Adafruit ADS1X15    by Adafruit
//   - WebSockets          by Markus Sattler (arduinoWebSockets)
//   - ArduinoJson         by Benoit Blanchon
//   - WiFiManager         by tzapu
//   - LittleFS is built into the ESP8266 Arduino core - no install needed
// =====================================================================

#include <ESP8266WiFi.h>
#include <SoftwareSerial.h>
#include <Wire.h>
#include <LittleFS.h>
#include <ModbusMaster.h>
#include <Adafruit_ADS1X15.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <WiFiManager.h>

// ---------------------- RS485 / Modbus pH sensor ----------------------
#define RS485_DIR_PIN  14   // D5 / GPIO14  (MAX485 DE+RE tied together)
#define RS485_RX_PIN   12   // D6 / GPIO12  (MAX485 RO -> ESP RX)
#define RS485_TX_PIN   13   // D7 / GPIO13  (MAX485 DI <- ESP TX)
#define MODBUS_SLAVE_ID 1
#define PH_REGISTER    0x0006
#define PH_DIVISOR     100.0  // verify against a pH 7 buffer solution

SoftwareSerial rs485Serial(RS485_RX_PIN, RS485_TX_PIN);
ModbusMaster node;

void preTransmission()  { digitalWrite(RS485_DIR_PIN, HIGH); delayMicroseconds(500); }
void postTransmission() { delayMicroseconds(500); digitalWrite(RS485_DIR_PIN, LOW); }

// ---------------------- ADS1115 (Turbidity + TDS) ----------------------
Adafruit_ADS1115 ads;
#define ADS_FULLSCALE_VOLTS  4.096
#define ADS_MAX_COUNTS       32767.0
#define TURBIDITY_CHANNEL  0   // A0
#define TDS_CHANNEL        1   // A1
#define ASSUMED_WATER_TEMP_C  25.0  // replace once a real temp sensor works

// ---------------------- Persisted configuration ----------------------
#define CONFIG_PATH "/config.json"

// NOTE: renamed from "Config" -> "DeviceConfig". SoftwareSerial.h (in the
// EspSoftwareSerial namespace, which this core pulls into global scope)
// already declares its own "enum Config", so a struct named "Config" in
// this file was ambiguous with it and failed to compile.
struct DeviceConfig {
  char wsHost[64]     = "";
  char wsPort[6]      = "443";
  char wsPath[32]     = "/api/ws";
  bool wsUseTLS       = true;
  char deviceToken[64] = "change-me-device-token";
  char deviceId[32]    = "soil-water-monitor-1";
};

DeviceConfig config;
bool shouldSaveConfig = false;

// Forward declaration - defined later, used by the serial command handler.
void connectWebSocketFwd();

// ---------------------- Boot-time WiFi retry tracking ----------------------
// Stored in RTC user memory so it survives ESP.restart() (a warm reboot)
// but resets on power loss - which is fine, since power loss is itself
// a fresh start worth retrying from scratch.
#define RTC_RETRY_MAGIC   0xA5C3
#define RTC_MEM_SLOT      0
struct RtcRetryData {
  uint16_t magic;
  uint16_t bootRetryCount;
};

const uint16_t WIFI_CONFIG_PORTAL_TIMEOUT_S = 120; // bounded, not indefinite
const uint16_t WIFI_MAX_BOOT_RETRIES = 5;          // retries before opening setup AP

uint16_t readBootRetryCount() {
  RtcRetryData d;
  ESP.rtcUserMemoryRead(RTC_MEM_SLOT, (uint32_t *)&d, sizeof(d));
  if (d.magic != RTC_RETRY_MAGIC) return 0; // uninitialized / power-on reset
  return d.bootRetryCount;
}

void writeBootRetryCount(uint16_t count) {
  RtcRetryData d;
  d.magic = RTC_RETRY_MAGIC;
  d.bootRetryCount = count;
  ESP.rtcUserMemoryWrite(RTC_MEM_SLOT, (uint32_t *)&d, sizeof(d));
}

bool loadConfig() {
  if (!LittleFS.exists(CONFIG_PATH)) return false;

  File f = LittleFS.open(CONFIG_PATH, "r");
  if (!f) return false;

  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, f);
  f.close();
  if (err) {
    Serial.println("Config file corrupt, ignoring it.");
    return false;
  }

  strlcpy(config.wsHost, doc["ws_host"] | "", sizeof(config.wsHost));
  strlcpy(config.wsPort, doc["ws_port"] | "443", sizeof(config.wsPort));
  strlcpy(config.wsPath, doc["ws_path"] | "/api/ws", sizeof(config.wsPath));
  config.wsUseTLS = doc["ws_tls"] | true;
  strlcpy(config.deviceToken, doc["device_token"] | "change-me-device-token", sizeof(config.deviceToken));
  strlcpy(config.deviceId, doc["device_id"] | "soil-water-monitor-1", sizeof(config.deviceId));

  return strlen(config.wsHost) > 0;
}

void saveConfig() {
  StaticJsonDocument<512> doc;
  doc["ws_host"] = config.wsHost;
  doc["ws_port"] = config.wsPort;
  doc["ws_path"] = config.wsPath;
  doc["ws_tls"] = config.wsUseTLS;
  doc["device_token"] = config.deviceToken;
  doc["device_id"] = config.deviceId;

  File f = LittleFS.open(CONFIG_PATH, "w");
  if (!f) {
    Serial.println("Failed to open config file for writing!");
    return;
  }
  serializeJson(doc, f);
  f.close();
  Serial.println("Config saved.");
}

void printConfig() {
  Serial.println("--- Current configuration ---");
  Serial.print("ws_host:      "); Serial.println(config.wsHost);
  Serial.print("ws_port:      "); Serial.println(config.wsPort);
  Serial.print("ws_path:      "); Serial.println(config.wsPath);
  Serial.print("ws_tls:       "); Serial.println(config.wsUseTLS ? "true" : "false");
  Serial.print("device_id:    "); Serial.println(config.deviceId);
  Serial.print("device_token: "); Serial.println(config.deviceToken);
  Serial.print("WiFi SSID:    "); Serial.println(WiFi.SSID());
  Serial.println("------------------------------");
}

// =====================================================================
// WiFiManager - captive portal for WiFi + WebSocket config
// =====================================================================

WiFiManager wm;

void saveConfigCallback() {
  shouldSaveConfig = true;
}

// Builds and runs the WiFiManager config portal. Blocks until the user
// submits the form (or it times out), then applies + saves the result.
void runConfigPortal(bool forceOpen) {
  WiFiManagerParameter p_ws_host("ws_host", "WebSocket host (e.g. myapp.vercel.app)", config.wsHost, 64);
  WiFiManagerParameter p_ws_port("ws_port", "WebSocket port", config.wsPort, 6);
  WiFiManagerParameter p_ws_path("ws_path", "WebSocket path", config.wsPath, 32);
  WiFiManagerParameter p_device_id("device_id", "Device ID", config.deviceId, 32);
  WiFiManagerParameter p_device_token("device_token", "Device token", config.deviceToken, 64);

  wm.addParameter(&p_ws_host);
  wm.addParameter(&p_ws_port);
  wm.addParameter(&p_ws_path);
  wm.addParameter(&p_device_id);
  wm.addParameter(&p_device_token);
  wm.setSaveConfigCallback(saveConfigCallback);
  wm.setConfigPortalTimeout(300); // give up and reboot after 5 min unattended

  bool connected;
  if (forceOpen) {
    Serial.println("Opening config portal: connect to WiFi \"WaterQualityMonitor-Setup\" to reconfigure.");
    connected = wm.startConfigPortal("WaterQualityMonitor-Setup");
  } else {
    Serial.println("No saved WiFi - opening setup AP \"WaterQualityMonitor-Setup\"...");
    connected = wm.autoConnect("WaterQualityMonitor-Setup");
  }

  if (!connected) {
    Serial.println("Config portal timed out without a connection. Restarting...");
    delay(1000);
    ESP.restart();
  }

  // Pull the custom field values back out and persist them.
  strlcpy(config.wsHost, p_ws_host.getValue(), sizeof(config.wsHost));
  strlcpy(config.wsPort, p_ws_port.getValue(), sizeof(config.wsPort));
  strlcpy(config.wsPath, p_ws_path.getValue(), sizeof(config.wsPath));
  strlcpy(config.deviceId, p_device_id.getValue(), sizeof(config.deviceId));
  strlcpy(config.deviceToken, p_device_token.getValue(), sizeof(config.deviceToken));

  if (shouldSaveConfig || forceOpen) {
    saveConfig();
    shouldSaveConfig = false;
  }

  Serial.println("WiFi connected via portal. IP: " + WiFi.localIP().toString());
}

// =====================================================================
// Serial config interface
// =====================================================================

String serialBuffer;

void handleSerialCommand(const String &line) {
  String cmd = line;
  cmd.trim();
  if (cmd.length() == 0) return;

  if (cmd.equalsIgnoreCase("show") || cmd.equalsIgnoreCase("config")) {
    if (cmd.equalsIgnoreCase("config")) {
      // Re-open the portal to change WiFi + server settings interactively.
      runConfigPortal(true);
    } else {
      printConfig();
    }
    return;
  }

  if (cmd.equalsIgnoreCase("reset")) {
    Serial.println("Erasing saved config and WiFi credentials, restarting...");
    LittleFS.remove(CONFIG_PATH);
    wm.resetSettings();
    delay(500);
    ESP.restart();
    return;
  }

  if (cmd.startsWith("set ")) {
    String rest = cmd.substring(4);
    int eq = rest.indexOf('=');
    if (eq < 0) {
      Serial.println("Usage: set <field>=<value>  (fields: ws_host, ws_port, ws_path, ws_tls, device_id, device_token)");
      return;
    }
    String field = rest.substring(0, eq);
    String value = rest.substring(eq + 1);
    field.trim();
    value.trim();

    bool matched = true;
    if (field == "ws_host") strlcpy(config.wsHost, value.c_str(), sizeof(config.wsHost));
    else if (field == "ws_port") strlcpy(config.wsPort, value.c_str(), sizeof(config.wsPort));
    else if (field == "ws_path") strlcpy(config.wsPath, value.c_str(), sizeof(config.wsPath));
    else if (field == "ws_tls") config.wsUseTLS = (value == "1" || value.equalsIgnoreCase("true"));
    else if (field == "device_id") strlcpy(config.deviceId, value.c_str(), sizeof(config.deviceId));
    else if (field == "device_token") strlcpy(config.deviceToken, value.c_str(), sizeof(config.deviceToken));
    else matched = false;

    if (matched) {
      saveConfig();
      Serial.println("Updated. Reconnecting WebSocket with new settings...");
      connectWebSocketFwd(); // forward declared below
    } else {
      Serial.println("Unknown field: " + field);
    }
    return;
  }

  Serial.println("Commands: show | config | reset | set <field>=<value>");
}

void pollSerialCommands() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialBuffer.length() > 0) {
        handleSerialCommand(serialBuffer);
        serialBuffer = "";
      }
    } else {
      serialBuffer += c;
    }
  }
}

// =====================================================================
// WebSocket
// =====================================================================

WebSocketsClient webSocket;
bool wsConnected = false;

// ---------------------- Offline reading buffer ----------------------
// While the WebSocket is down, readings are kept here (oldest overwritten
// first if it fills up) instead of being dropped, then flushed in order
// once the connection comes back.
#define READING_BUFFER_SIZE 20
struct BufferedReading {
  bool phOk;
  float ph;
  float turbidityNTU;
  float tdsPPM;
  unsigned long ts;
};
BufferedReading readingBuffer[READING_BUFFER_SIZE];
int bufferCount = 0;   // how many valid entries are currently buffered
int bufferHead = 0;    // index where the next reading will be written

void bufferReading(bool phOk, float ph, float turbidityNTU, float tdsPPM, unsigned long ts) {
  readingBuffer[bufferHead] = { phOk, ph, turbidityNTU, tdsPPM, ts };
  bufferHead = (bufferHead + 1) % READING_BUFFER_SIZE;
  if (bufferCount < READING_BUFFER_SIZE) {
    bufferCount++;
  } else {
    Serial.println("Reading buffer full - oldest buffered reading dropped.");
  }
}

void sendReadingNow(bool phOk, float ph, float turbidityNTU, float tdsPPM, unsigned long ts) {
  StaticJsonDocument<256> doc;
  doc["device_id"] = config.deviceId;
  doc["token"] = config.deviceToken;
  doc["ts"] = ts;
  if (phOk) doc["ph"] = ph; else doc["ph"] = nullptr;
  doc["turbidity_ntu"] = turbidityNTU;
  doc["tds_ppm"] = tdsPPM;

  char buffer[256];
  size_t len = serializeJson(doc, buffer);
  webSocket.sendTXT(buffer, len);
}

// Called once the WebSocket reconnects - sends every buffered reading,
// oldest first, then clears the buffer.
void flushBufferedReadings() {
  if (bufferCount == 0) return;
  Serial.print("Flushing "); Serial.print(bufferCount); Serial.println(" buffered reading(s)...");

  // Oldest entry is at (bufferHead - bufferCount) mod SIZE.
  int idx = (bufferHead - bufferCount + READING_BUFFER_SIZE) % READING_BUFFER_SIZE;
  for (int i = 0; i < bufferCount; i++) {
    BufferedReading &r = readingBuffer[idx];
    sendReadingNow(r.phOk, r.ph, r.turbidityNTU, r.tdsPPM, r.ts);
    idx = (idx + 1) % READING_BUFFER_SIZE;
  }
  bufferCount = 0;
  bufferHead = 0;
  Serial.println("Buffer flush complete.");
}

// Handles a "set_config" JSON command pushed by the server over the
// already-open WebSocket connection. Any subset of fields may be
// present; only those are updated. Saves to flash and sends an ack.
void handleRemoteSetConfig(JsonObject cmdDoc) {
  bool changedWsTarget = false;

  if (cmdDoc.containsKey("device_id")) {
    strlcpy(config.deviceId, cmdDoc["device_id"] | config.deviceId, sizeof(config.deviceId));
  }
  if (cmdDoc.containsKey("device_token")) {
    strlcpy(config.deviceToken, cmdDoc["device_token"] | config.deviceToken, sizeof(config.deviceToken));
  }
  if (cmdDoc.containsKey("ws_host")) {
    strlcpy(config.wsHost, cmdDoc["ws_host"] | config.wsHost, sizeof(config.wsHost));
    changedWsTarget = true;
  }
  if (cmdDoc.containsKey("ws_port")) {
    strlcpy(config.wsPort, cmdDoc["ws_port"] | config.wsPort, sizeof(config.wsPort));
    changedWsTarget = true;
  }
  if (cmdDoc.containsKey("ws_path")) {
    strlcpy(config.wsPath, cmdDoc["ws_path"] | config.wsPath, sizeof(config.wsPath));
    changedWsTarget = true;
  }
  if (cmdDoc.containsKey("ws_tls")) {
    config.wsUseTLS = cmdDoc["ws_tls"] | config.wsUseTLS;
    changedWsTarget = true;
  }

  saveConfig();
  Serial.println("Config updated remotely via WebSocket.");

  StaticJsonDocument<128> ack;
  ack["type"] = "config_ack";
  ack["device_id"] = config.deviceId;
  char buf[128];
  size_t len = serializeJson(ack, buf);
  webSocket.sendTXT(buf, len);

  // If the host/port/path/tls changed, the current socket target is
  // stale - reconnect. If only device_id/token changed, the existing
  // connection is fine as-is; new values are simply used on the next
  // publishReading() call.
  if (changedWsTarget) {
    webSocket.disconnect();
    connectWebSocketFwd();
  }
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
      flushBufferedReadings();
      break;
    case WStype_TEXT: {
      StaticJsonDocument<256> cmdDoc;
      DeserializationError err = deserializeJson(cmdDoc, payload, length);
      if (err) {
        Serial.println("Received malformed WS text frame, ignoring.");
        break;
      }
      const char *cmd = cmdDoc["cmd"] | "";
      if (strcmp(cmd, "set_config") == 0) {
        handleRemoteSetConfig(cmdDoc.as<JsonObject>());
      }
      break;
    }
    case WStype_ERROR:
      Serial.println("WebSocket error");
      break;
    default:
      break;
  }
}

void connectWebSocket() {
  if (strlen(config.wsHost) == 0) {
    Serial.println("No WebSocket host configured yet - skipping connect.");
    return;
  }
  uint16_t port = atoi(config.wsPort);
  if (config.wsUseTLS) {
    webSocket.beginSSL(config.wsHost, port, config.wsPath);
  } else {
    webSocket.begin(config.wsHost, port, config.wsPath);
  }
  webSocket.onEvent(onWsEvent);
  webSocket.setReconnectInterval(5000);
  webSocket.enableHeartbeat(15000, 3000, 2);
}

// Allows the serial "set" handler and remote set_config handler above
// to reconnect with new settings even though they're defined earlier
// in the file.
void connectWebSocketFwd() {
  webSocket.disconnect();
  connectWebSocket();
}

// =====================================================================
// Sensor reading
// =====================================================================

bool readPH(float *outPh) {
  uint8_t result = node.readHoldingRegisters(PH_REGISTER, 1);
  if (result != node.ku8MBSuccess) return false;
  uint16_t raw = node.getResponseBuffer(0);
  *outPh = raw / PH_DIVISOR;
  return true;
}

float countsToVolts(int16_t counts) {
  return (counts * ADS_FULLSCALE_VOLTS) / ADS_MAX_COUNTS;
}

float voltageToNTU(float voltage) {
  if (voltage < 0) voltage = 0;
  float ntu = -1120.4 * voltage * voltage + 5742.3 * voltage - 4352.9;
  if (ntu < 0) ntu = 0;
  return ntu;
}

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

void publishReading(bool phOk, float ph, float turbidityNTU, float tdsPPM) {
  unsigned long ts = millis();

  if (wsConnected) {
    sendReadingNow(phOk, ph, turbidityNTU, tdsPPM, ts);
  } else {
    bufferReading(phOk, ph, turbidityNTU, tdsPPM, ts);
  }

  Serial.print("Reading ");
  Serial.print(wsConnected ? "published" : "buffered (offline)");
  Serial.print(": ph=");
  if (phOk) Serial.print(ph); else Serial.print("null");
  Serial.print(" turbidity_ntu="); Serial.print(turbidityNTU);
  Serial.print(" tds_ppm="); Serial.println(tdsPPM);
}

// =====================================================================
// Setup / Loop
// =====================================================================

const unsigned long READ_INTERVAL_MS = 3000;
unsigned long lastReadMs = 0;

// ---------------------- Mid-run WiFi reconnect backoff ----------------------
const unsigned long WIFI_RECONNECT_MIN_INTERVAL_MS = 5000;    // start: retry every 5s
const unsigned long WIFI_RECONNECT_MAX_INTERVAL_MS = 60000;   // cap: at most every 60s
const unsigned long WIFI_STATUS_LOG_INTERVAL_MS    = 30000;   // log at most every 30s
unsigned long wifiReconnectInterval = WIFI_RECONNECT_MIN_INTERVAL_MS;
unsigned long lastWifiReconnectAttemptMs = 0;
unsigned long lastWifiStatusLogMs = 0;
unsigned long wifiDownSinceMs = 0;
bool wifiWasConnected = true;

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n--- Water Quality Monitor booting ---");

  if (!LittleFS.begin()) {
    Serial.println("LittleFS mount failed - formatting...");
    LittleFS.format();
    LittleFS.begin();
  }

  bool haveConfig = loadConfig();
  if (haveConfig) {
    Serial.println("Loaded saved config:");
    printConfig();
  } else {
    Serial.println("No saved config found.");
  }

  // RS485 / Modbus pH sensor
  pinMode(RS485_DIR_PIN, OUTPUT);
  digitalWrite(RS485_DIR_PIN, LOW);
  rs485Serial.begin(9600);
  node.begin(MODBUS_SLAVE_ID, rs485Serial);
  node.preTransmission(preTransmission);
  node.postTransmission(postTransmission);

  // ADS1115 (Turbidity + TDS)
  Wire.begin(4, 5); // SDA=D2/GPIO4, SCL=D1/GPIO5
  if (!ads.begin()) {
    Serial.println("Failed to initialize ADS1115 - check wiring!");
  }
  ads.setGain(GAIN_ONE);

  // WiFi + server config: if we have no saved WiFi at all, WiFiManager's
  // autoConnect() will open the setup AP automatically. If we have WiFi
  // saved but no WebSocket host configured yet, force the portal too so
  // the user can fill that part in.
  if (!haveConfig) {
    // No server config saved at all yet - this is first-time setup, so
    // it's fine (and necessary) to wait in the portal for a human.
    runConfigPortal(false);
    writeBootRetryCount(0);
  } else {
    WiFi.mode(WIFI_STA);
    wm.setConfigPortalTimeout(WIFI_CONFIG_PORTAL_TIMEOUT_S);
    bool connected = wm.autoConnect("WaterQualityMonitor-Setup");

    if (connected) {
      writeBootRetryCount(0);
      Serial.println("WiFi connected. IP: " + WiFi.localIP().toString());
    } else {
      uint16_t retries = readBootRetryCount();
      if (retries < WIFI_MAX_BOOT_RETRIES) {
        retries++;
        writeBootRetryCount(retries);
        Serial.print("Could not reach saved WiFi (attempt ");
        Serial.print(retries);
        Serial.print("/");
        Serial.print(WIFI_MAX_BOOT_RETRIES);
        Serial.println("). Restarting to retry shortly...");
        delay(2000);
        ESP.restart();
      } else {
        // Repeated failures - the saved network is probably genuinely
        // gone (moved, password changed, router replaced). Give up on
        // silent retries and open the setup AP so a human can fix it.
        writeBootRetryCount(0);
        Serial.println("Repeated WiFi failures - opening setup AP for manual reconfiguration...");
        runConfigPortal(true);
      }
    }
  }

  connectWebSocket();

  Serial.println("--- Setup complete ---");
  Serial.println("Serial commands: show | config | reset | set <field>=<value>\n");
}

void loop() {
  pollSerialCommands();

  unsigned long nowMs = millis();
  bool wifiUp = (WiFi.status() == WL_CONNECTED);

  if (!wifiUp) {
    if (wifiWasConnected) {
      // Just dropped - start tracking the outage and reset backoff.
      wifiDownSinceMs = nowMs;
      wifiReconnectInterval = WIFI_RECONNECT_MIN_INTERVAL_MS;
      lastWifiStatusLogMs = 0; // force an immediate log below
      Serial.println("WiFi dropped - will retry with backoff.");
    }

    if (nowMs - lastWifiReconnectAttemptMs >= wifiReconnectInterval) {
      lastWifiReconnectAttemptMs = nowMs;
      WiFi.reconnect();
      // Exponential backoff, capped, so a prolonged outage doesn't spam
      // reconnect attempts indefinitely.
      wifiReconnectInterval = min(wifiReconnectInterval * 2, WIFI_RECONNECT_MAX_INTERVAL_MS);
    }

    if (nowMs - lastWifiStatusLogMs >= WIFI_STATUS_LOG_INTERVAL_MS) {
      lastWifiStatusLogMs = nowMs;
      Serial.print("Still offline - down for ");
      Serial.print((nowMs - wifiDownSinceMs) / 1000);
      Serial.print("s ("); Serial.print(bufferCount); Serial.println(" reading(s) buffered).");
    }
  } else if (!wifiWasConnected) {
    Serial.println("WiFi reconnected. IP: " + WiFi.localIP().toString());
  }
  wifiWasConnected = wifiUp;

  webSocket.loop();

  unsigned long now = millis();
  if (now - lastReadMs >= READ_INTERVAL_MS) {
    lastReadMs = now;

    float ph = 0;
    bool phOk = readPH(&ph);

    int16_t rawTurbidity = ads.readADC_SingleEnded(TURBIDITY_CHANNEL);
    int16_t rawTds       = ads.readADC_SingleEnded(TDS_CHANNEL);

    float turbidityVolts = countsToVolts(rawTurbidity);
    float tdsVolts = countsToVolts(rawTds);

    float turbidityNTU = voltageToNTU(turbidityVolts);
    float tdsPPM = voltageToTDS(tdsVolts, ASSUMED_WATER_TEMP_C);

    publishReading(phOk, ph, turbidityNTU, tdsPPM);
  }
}
