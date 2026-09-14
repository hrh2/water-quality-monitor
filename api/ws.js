// Vercel Function serving a native WebSocket endpoint at /api/ws
//
// - The ESP8266 firmware connects here and sends JSON readings.
// - Any browser dashboard also connects here (as a "viewer") and
//   receives every reading broadcast in real time.
//
// Notes:
// - Vercel's native WebSocket support (public beta) pins a connection
//   to one Function instance for its lifetime. There is no shared
//   state across separate instances, so this single-file in-memory
//   approach works for a single low-traffic device + a handful of
//   dashboard viewers, but won't scale across multiple instances.
//   For durable multi-instance state, Vercel recommends Redis from
//   the Vercel Marketplace - not needed for a single sensor setup.
// - Change DEVICE_TOKEN below to match the token set in the firmware.

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const DEVICE_TOKEN = 'change-me-device-token';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Keep the most recent reading in memory so new dashboard viewers
// immediately see the latest values instead of waiting for the next
// publish from the device.
let lastReading = null;

// Track connected dashboard viewers separately from the device itself,
// so we only broadcast to viewers (not echo back to the device).
const viewers = new Set();

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      return; // ignore malformed messages
    }

    // Messages from the ESP8266 device carry a token + device_id.
    if (msg.token !== undefined) {
      if (msg.token !== DEVICE_TOKEN) {
        // Reject readings that don't have the right token.
        return;
      }
      lastReading = {
        device_id: msg.device_id ?? 'unknown',
        ts: msg.ts ?? Date.now(),
        ph: msg.ph ?? null,
        turbidity_ntu: msg.turbidity_ntu ?? null,
        tds_ppm: msg.tds_ppm ?? null,
        received_at: Date.now(),
      };

      const payload = JSON.stringify(lastReading);
      for (const viewer of viewers) {
        if (viewer.readyState === viewer.OPEN) {
          viewer.send(payload);
        }
      }
      return;
    }

    // Anything else is treated as a dashboard viewer registering itself.
    if (msg.type === 'subscribe') {
      viewers.add(ws);
      if (lastReading) {
        ws.send(JSON.stringify(lastReading));
      }
    }
  });

  ws.on('close', () => {
    viewers.delete(ws);
  });
});

// Ping every connection periodically to detect dead sockets
// (e.g. the ESP8266 losing WiFi without a clean close).
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      viewers.delete(ws);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);

wss.on('close', () => clearInterval(heartbeat));

export default server;
