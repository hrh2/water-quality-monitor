// Vercel Function serving a native WebSocket endpoint at /api/ws
//
// - The ESP8266 firmware connects here and sends JSON readings (unchanged
//   wire format - see docs/architecture/data-contract.md).
// - Any browser dashboard also connects here (as a "viewer") and receives
//   every enriched reading (sensor values + ML prediction) broadcast in
//   real time.
// - Each reading is persisted, run through the ML prediction pipeline, and
//   checked for contamination risk via api/_lib/ingest.js - the SAME
//   pipeline used by the POST /api/readings HTTP fallback, so the two
//   ingestion paths can't drift apart.
//
// Notes (unchanged from the original design, still true):
// - Vercel's native WebSocket support (public beta) pins a connection to
//   one Function instance for its lifetime. There is no shared state
//   across separate instances, so `lastReading`/`viewers` here work for a
//   single low-traffic device + a handful of dashboard viewers, but won't
//   scale across multiple instances without Redis or similar.
// - Device tokens are no longer a single shared constant: each device
//   registered via POST /api/devices has its own bcrypt-hashed token,
//   checked in api/_lib/ingest.js::authenticateDevice.

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { ingestReading, IngestError } from './_lib/ingest.js';
import { query } from './_lib/db.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Keep the most recent enriched reading in memory so new dashboard viewers
// immediately see the latest values instead of waiting for the next
// publish from the device.
let lastReading = null;

// Track connected dashboard viewers separately from the device itself, so
// we only broadcast to viewers (not echo back to the device).
const viewers = new Set();

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const viewer of viewers) {
    if (viewer.readyState === viewer.OPEN) {
      viewer.send(message);
    }
  }
}

async function recordSystemEvent(eventType, message, metadata) {
  try {
    await query(
      'INSERT INTO system_events (event_type, message, metadata) VALUES ($1, $2, $3)',
      [eventType, message, metadata ? JSON.stringify(metadata) : null]
    );
  } catch (err) {
    // Logging failure shouldn't take down the WS connection.
    console.error('Failed to record system_event:', err);
  }
}

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      return; // ignore malformed messages
    }

    // Messages from the ESP8266 device carry a token + device_id.
    if (msg.token !== undefined) {
      try {
        const enriched = await ingestReading(msg);
        lastReading = enriched;
        broadcast(enriched);
      } catch (err) {
        if (err instanceof IngestError) {
          // Expected rejection (bad payload, unknown device, bad token) -
          // log it but don't crash the connection or leak internals to
          // the socket.
          await recordSystemEvent('reading_rejected', err.message, { device_id: msg.device_id });
        } else {
          console.error('Unexpected error ingesting reading:', err);
          await recordSystemEvent('reading_ingest_error', err.message, { device_id: msg.device_id, stack: err.stack });
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

  ws.on('error', async () => {
    await recordSystemEvent('ws_connection_error', 'WebSocket connection error', null);
  });
});

// Ping every connection periodically to detect dead sockets (e.g. the
// ESP8266 losing WiFi without a clean close).
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
