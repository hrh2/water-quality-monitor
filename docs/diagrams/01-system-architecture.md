# Diagram 01: System Architecture

The complete system spans four tiers: physical sensors wired to an ESP8266,
a Vercel-hosted Node.js backend that ingests, predicts, and persists, a
Postgres database, and an admin dashboard consuming both a WebSocket stream
and a REST API. This diagram gives the top-level shape; see
`docs/architecture/overview.md` for the narrative walkthrough and
`docs/diagrams/03-software-architecture.md` for the internal component
breakdown of the backend.

```mermaid
flowchart TB
    subgraph Field
        S1[RS485 pH probe]
        S2[ADS1115: turbidity A0, TDS A1]
        FW[ESP8266 Firmware]
        S1 --> FW
        S2 --> FW
    end

    FW <-->|WebSocket wss://.../api/ws| BE

    subgraph BE[Vercel Serverless Backend]
        WS[api/ws.js]
        REST[api/*.js REST routes]
        LIB[api/_lib/* shared logic]
        WS --> LIB
        REST --> LIB
    end

    LIB --> DB[(PostgreSQL)]
    LIB --> MODEL[[ml/models/portable_model.json]]

    BE <-->|WebSocket + REST, Bearer JWT| DASH[Admin Dashboard\npublic/*]
```

Three things this diagram intentionally shows as one box each, expanded
elsewhere: the firmware's offline-buffering/reconnect behavior
(`docs/diagrams/02-iot-communication-architecture.md`), the backend's
internal module structure (`docs/diagrams/03-software-architecture.md`),
and the database's tables (`docs/diagrams/06-database-er-diagram.md`).
