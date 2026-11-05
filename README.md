# LiveWire ⬡

**A real-time live sports scoreboard.** LiveWire ingests real scoreboards for football,
cricket, and basketball, stores them in PostgreSQL, and pushes every score, status, and
commentary update to connected browsers over WebSockets — no polling, no page refreshes.

> Built with **Node.js · Express 5 · PostgreSQL (Neon) · Drizzle ORM · `ws` · React 19 · Vite · Arcjet**

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Database Setup](#database-setup)
  - [Running the App](#running-the-app)
  - [Seeding Demo Data](#seeding-demo-data)
- [Available Scripts](#available-scripts)
- [REST API](#rest-api)
- [WebSocket API](#websocket-api)
- [Data Model](#data-model)
- [Live Data Ingestion](#live-data-ingestion)
- [Scoring Rules](#scoring-rules)
- [Frontend](#frontend)
- [Security](#security)
- [Testing](#testing)
- [Operations](#operations)
- [Troubleshooting](#troubleshooting)
- [Known Limitations & Roadmap](#known-limitations--roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

Live sports sites are latency-sensitive. The naive approach — polling an API every few
seconds — either floods the backend or shows stale scores. LiveWire keeps one persistent
WebSocket per client and lets the server decide when to push:

1. **Ingestion** — a background loop polls ESPN's public scoreboards every 20 seconds for
   13 football/basketball leagues plus cricket, normalizes the responses into one shape,
   and upserts them into Postgres.
2. **Change detection** — only games whose score, status, teams, or clock actually changed
   are written and broadcast.
3. **Fan-out** — score and match-list updates go to every connected client; commentary is
   delivered only to clients subscribed to that specific match.
4. **UI** — React renders Live / Upcoming / Earlier groups, a match scoreboard, and a
   scrolling commentary feed, updating in place as socket events arrive.

The result is a scoreboard that is typically less than one poll interval (~20s) behind the
upstream feed, with updates reaching the browser instantly when they occur.

---

## Features

### Backend
- **Real WebSocket server** using `ws` with a manual HTTP upgrade handler
- **Per-match subscriptions** (`subscribe` / `unsubscribe`) backed by an in-memory
  `Map<matchId, Set<socket>>` with O(1) lookup and full cleanup on disconnect
- **Heartbeat detection** — server-side ping/pong every 30s terminates half-open sockets
- **Live ingestion** from ESPN for football, cricket, and basketball
- **Idempotent upserts** keyed on `external_id`, so repeated polls never duplicate games
- **Change detection** to avoid redundant DB writes and socket traffic
- **Automatic status transitions** (`scheduled → live → finished`) derived from match times
- **Score updates from commentary** using atomic SQL increments
- **Generated match highlights** for finished games that lack play-by-play data
- **Zod validation** on every request boundary
- **Graceful shutdown** on `SIGINT` / `SIGTERM`
- **APM instrumentation** via Site24x7's `apminsight`

### Frontend
- **React 19 + Vite**, hooks only — no state-management dependency
- **Auto-reconnecting WebSocket** with exponential backoff (1s → 15s)
- **Live, upcoming, and finished** match grouping with derived status and clocks
- **Sport filter** generated from the data itself
- **Per-match scoreboard + commentary feed** with event badges and tags
- **Duplicate-safe updates** — commentary is deduped by row id
- Fully responsive layout, dark sports-broadcast styling

### Security
- **Arcjet** shield, bot detection, and sliding-window rate limits on both HTTP and
  WebSocket upgrades, with `DRY_RUN` support for safe rollout
- Input size and query-limit caps (`MAX_LIMIT = 100`, `maxPayload = 1 MB`)

---

## Architecture

```
┌───────────────────────────────┐
│  React 19 + Vite              │
│                               │
│  useMatches    useLiveSocket  │
│  (REST fetch)  (WS + backoff) │
└──────────────┬────────────────┘
               │  GET /matches, /matches/:id/commentary
               │  ws://<host>/ws
               ▼
┌─────────────────────────────────────────────────────────┐
│  Node.js / Express 5                                    │
│                                                         │
│  Arcjet HTTP middleware                                 │
│  ├── /matches              GET, POST, DELETE            │
│  └── /matches/:id/commentary   GET, POST, POST /batch   │
│                                                         │
│  http.Server                                            │
│  └── 'upgrade' → Arcjet check → WebSocketServer         │
│       • subscriptions: Map<matchId, Set<socket>>        │
│       • ping/pong heartbeat (30s)                       │
│                                                         │
│  Background loops                                       │
│  ├── status reconciliation   (30s)                      │
│  └── ESPN scoreboard sync    (20s, in-flight guarded)   │
└───────────────┬───────────────────────┬─────────────────┘
                │ Drizzle ORM           │ undici fetch
                ▼                       ▼
      ┌──────────────────┐     ┌──────────────────────────┐
      │ Neon PostgreSQL  │     │ ESPN public scoreboards  │
      │ matches          │     │ 13 leagues + cricket     │
      │ commentary       │     │ header endpoint          │
      └──────────────────┘     └──────────────────────────┘
```

**Design principle:** HTTP is used for all *client-originated* reads and writes. The
WebSocket is a *server-originated* fan-out channel. Mutations therefore stay validated,
testable, and transactional; the socket never becomes a command bus.

---

## Tech Stack

| Area | Technology | Role |
|---|---|---|
| Runtime | Node.js 20+ (ES modules) | HTTP server, background jobs, ingestion |
| Web framework | Express 5 | REST routes and middleware |
| Real-time | `ws` | WebSocket server, heartbeat, subscriptions |
| Database | PostgreSQL on Neon | Persistent matches and commentary |
| ORM / migrations | Drizzle ORM + drizzle-kit | Typed schema, SQL queries, migrations |
| Validation | Zod 4 | Request body, params, and query validation |
| Upstream data | ESPN public JSON endpoints (`undici`) | Live scores and schedules |
| Security | Arcjet | Bot detection, shield, rate limiting |
| Frontend | React 19, Vite 8 | SPA, hooks, dev proxy |
| Lint | oxlint | Fast JS/JSX linting |
| Tests | `node:test`, `ws` client | End-to-end HTTP + WebSocket test |
| APM | Site24x7 `apminsight` | Performance and error monitoring |

---

## Project Structure

```
.
├── src/
│   ├── index.js                  # App bootstrap: Express, HTTP, WS, timers, shutdown
│   ├── arcjet.js                 # Arcjet HTTP middleware + WS rate-limit clients
│   ├── constants.js              # Shared constants (MAX_LIMIT)
│   ├── db/
│   │   ├── index.js              # Neon driver + Drizzle instance
│   │   ├── schema.js             # matches / commentary tables, status enum
│   │   └── push.js               # Destructive schema bootstrap (drop + recreate)
│   ├── routes/
│   │   ├── matches.js            # List / create / delete matches
│   │   └── commentary.js         # List / create / batch commentary + score deltas
│   ├── validation/
│   │   ├── matches.js            # Match schemas, MATCH_STATUS, id + query schemas
│   │   └── commentary.js         # Commentary and batch schemas
│   ├── utils/
│   │   ├── match-status.js       # Status derivation + full-table reconciliation
│   │   └── score.js              # Event → score delta + atomic SQL increments
│   ├── live/
│   │   ├── espn.js               # Scoreboard fetch, normalization, cricket parser
│   │   ├── index.js              # Upsert / diff / broadcast orchestration
│   │   └── summary.js            # Generated highlights for finished matches
│   ├── seed/
│   │   └── seed.js               # REST-based seeder + live streaming simulation
│   └── data/
│       └── data.json             # 18 template matches, 1,200 commentary entries
├── drizzle/                      # Generated SQL migrations and snapshots
├── tests/
│   └── commentary.test.js        # End-to-end REST + WebSocket integration test
├── frontend/
│   ├── src/
│   │   ├── App.jsx               # View switch, derived grouping, socket wiring
│   │   ├── api.js                # REST fetch helpers
│   │   ├── utils.js              # Status, clock, badge, score formatting
│   │   ├── hooks/
│   │   │   ├── useLiveSocket.js  # Reconnect/backoff/subscription hook
│   │   │   └── useMatches.js     # Initial match fetch + insert on create
│   │   └── components/           # Header, MatchCard, Scoreboard, feed, filters
│   ├── vite.config.js            # Dev server + /matches and /ws proxy
│   └── index.html
├── drizzle.config.js
├── package.json
└── .env                          # Local secrets (git-ignored)
```

---

## Getting Started

### Prerequisites

- **Node.js 20 or newer** (uses ESM and top-level `await`)
- **npm**
- A **PostgreSQL** database — [Neon](https://neon.tech) is used here via its serverless
  HTTP driver
- An **Arcjet** API key ([arcjet.com](https://arcjet.com)) — required at startup
- Network access to `site.api.espn.com` for live data (optional for offline development)

### Installation

```bash
git clone https://github.com/itsXILO/LiveWire.git
cd LiveWire

# backend
npm install

# frontend
npm install --prefix frontend
```

### Environment Variables

Create a `.env` file in the project root:

```dotenv
# ── Required ────────────────────────────────────────────────
DATABASE_URL=postgresql://user:password@host/db?sslmode=require
ARCJET_KEY=ajkey_your_key_here

# ── Server ──────────────────────────────────────────────────
PORT=8100
HOST=0.0.0.0

# ── Arcjet ──────────────────────────────────────────────────
# DRY_RUN logs decisions without blocking. Omit or use LIVE to enforce.
ARCJET_MODE=DRY_RUN

# ── Background jobs (milliseconds) ─────────────────────────
STATUS_SYNC_INTERVAL_MS=30000
LIVE_FETCH_INTERVAL_MS=20000

# ── Seeder ──────────────────────────────────────────────────
API_URL=http://localhost:8100
# STREAM_INTERVAL_MS=2500
# SEED_LIVE_COUNT=6
# SEED_CONCURRENCY=4
# LIVE_DELAY_MS=250
# FINISHED_DELAY_MS=20
# SEED_RESET=1
```

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string. App throws at boot if missing. |
| `ARCJET_KEY` | ✅ | — | Arcjet SDK key. App throws at boot if missing. |
| `PORT` | — | `8000` | HTTP + WebSocket port. **Set to `8100` to match the Vite proxy.** |
| `HOST` | — | `0.0.0.0` | Bind address |
| `ARCJET_MODE` | — | `LIVE` | `DRY_RUN` observes only; anything else enforces |
| `STATUS_SYNC_INTERVAL_MS` | — | `30000` | Match status reconciliation period |
| `LIVE_FETCH_INTERVAL_MS` | — | `20000` | ESPN scoreboard polling period |
| `API_URL` | seeder | — | Base URL the seeder posts to |
| `STREAM_INTERVAL_MS` | seeder | `2500` | Delay between streamed live commentary rounds |
| `SEED_LIVE_COUNT` | seeder | `6` | Number of seeded matches that are live "now" |
| `SEED_CONCURRENCY` | seeder | `4` | Parallel commentary batch requests |
| `LIVE_DELAY_MS` / `FINISHED_DELAY_MS` | seeder | `250` / `20` | Per-request delay for each match type |
| `SEED_RESET` | seeder | on | Set to `0`/`false` to keep existing rows |

> **Never commit `.env` or `apminsightnode.json`.** Both are git-ignored. The APM config
> contains a Site24x7 license key; if it's absent the agent logs a warning and the server
> continues without APM.

### Database Setup

Either apply the checked-in migration:

```bash
npm run db:generate   # only needed after schema changes
npm run db:migrate
```

…or bootstrap from scratch with the destructive helper:

```bash
npm run db:push       # DROPS commentary, matches, and the enum, then recreates them
```

> ⚠️ `db:push` deletes all existing data. It is intended for local development only.

Optionally inspect data with Drizzle Studio:

```bash
npm run db:studio
```

### Running the App

```bash
npm run dev
```

This starts both processes concurrently:

| Process | Command | URL |
|---|---|---|
| Backend | `nodemon src/index.js` | `http://localhost:8100` |
| Frontend | `vite` (in `frontend/`) | `http://localhost:5173` |
| WebSocket | attached to backend | `ws://localhost:8100/ws` |

Open **http://localhost:5173**. The connection badge in the header shows
`Connecting` → `Live` once the socket is established.

Backend only:

```bash
npm run dev:server
```

Frontend only (expects the backend on `8100`):

```bash
npm run dev:client
```

> **Port note:** the Vite proxy in `frontend/vite.config.js` targets port **8100**. The
> server defaults to `8000`, so set `PORT=8100` in `.env` (recommended) or update the proxy
> target to match.

### Seeding Demo Data

The seeder drives the public REST API — it exercises real validation, scoring, and
broadcast paths rather than writing to the database directly.

```bash
# 1. Make sure the backend is running, then:
API_URL=http://localhost:8100 node src/seed/seed.js
```

What it does:

1. Wipes existing matches and commentary (`SEED_RESET`).
2. Creates the 18 template matches from `src/data/data.json` (7 football, 7 cricket,
   4 basketball), with 6 of them scheduled to be **live right now** and the rest placed
   over the previous ~48 hours.
3. Loads 1,200 commentary entries, cloning same-sport templates for matches without one
   and balancing scoring so final results look realistic.
4. Ingests finished matches in **batches of 100** so their final scores are complete.
5. Streams live-match commentary **one event at a time every ~2.5s**, so you can watch
   scores change on the site in real time. Press `Ctrl+C` to stop.

Useful overrides:

```bash
SEED_LIVE_COUNT=3 STREAM_INTERVAL_MS=1000 SEED_RESET=0 \
  API_URL=http://localhost:8100 node src/seed/seed.js
```

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Run backend and frontend together |
| `npm run dev:server` | Backend with nodemon |
| `npm run dev:client` | Frontend Vite dev server |
| `npm start` | Backend in production mode |
| `npm run build:client` | Build the React app to `frontend/dist` |
| `npm run db:generate` | Generate a migration from the Drizzle schema |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:push` | Drop and recreate the schema (**destructive**) |
| `npm run db:studio` | Open Drizzle Studio |
| `npm test` | Run the `node:test` integration suite |

---

## REST API

Base URL: `http://localhost:<PORT>`

All responses are JSON. Validation failures return `400` with an `error` and `details`
field; unexpected failures return `500` with a generic message.

### `GET /` — Health check

```bash
curl http://localhost:8100/
# Hello from Express server!
```

### `GET /matches` — List matches

Returns matches newest-first.

| Query | Type | Default | Max |
|---|---|---|---|
| `limit` | integer | `50` | `100` |

```bash
curl "http://localhost:8100/matches?limit=20"
```

```json
{
  "data": [
    {
      "id": 42,
      "externalId": "espn:eng.1:704512",
      "sport": "football",
      "homeTeam": "Arsenal",
      "awayTeam": "Liverpool",
      "status": "live",
      "startTime": "2026-11-05T15:00:00.000Z",
      "endTime": "2026-11-05T17:00:00.000Z",
      "homeScore": 2,
      "awayScore": 1,
      "homeRuns": 0,
      "homeWickets": 0,
      "awayRuns": 0,
      "awayWickets": 0,
      "createdAt": "2026-11-05T14:59:58.123Z"
    }
  ]
}
```

### `POST /matches` — Create a match

| Field | Type | Required | Notes |
|---|---|---|---|
| `sport` | string | ✅ | e.g. `football`, `cricket`, `basketball` |
| `homeTeam` | string | ✅ | |
| `awayTeam` | string | ✅ | |
| `startTime` | ISO date string | ✅ | |
| `endTime` | ISO date string | ✅ | Must be after `startTime` |
| `homeScore` / `awayScore` | integer ≥ 0 | — | Default `0` |

The initial status is derived from the times, not supplied by the client. On success the
new match is broadcast as `match_created` to all WebSocket clients.

```bash
curl -X POST http://localhost:8100/matches \
  -H 'Content-Type: application/json' \
  -d '{
    "sport": "football",
    "homeTeam": "Arsenal",
    "awayTeam": "Liverpool",
    "startTime": "2026-11-05T15:00:00Z",
    "endTime": "2026-11-05T17:00:00Z"
  }'
```

`201 Created`

```json
{ "data": { "id": 42, "status": "scheduled", "...": "..." } }
```

### `DELETE /matches` — Reset data

Deletes all commentary and matches. Intended for seeding and local development.

```bash
curl -X DELETE http://localhost:8100/matches
# { "ok": true }
```

### `GET /matches/:id/commentary` — Read a match feed

| Query | Type | Default | Max |
|---|---|---|---|
| `limit` | integer | `100` | `100` |

Results are newest-first.

```bash
curl "http://localhost:8100/matches/42/commentary?limit=50"
```

```json
{
  "data": [
    {
      "id": 901,
      "matchId": 42,
      "minute": 67,
      "sequence": 12,
      "period": "2H",
      "eventType": "goal",
      "actor": "Saka",
      "team": "Arsenal",
      "message": "GOAL! Arsenal (Arsenal 2-1 Liverpool)",
      "metadata": { "assist": "Odegaard" },
      "tags": ["goal"],
      "createdAt": "2026-11-05T16:07:00.000Z"
    }
  ]
}
```

### `POST /matches/:id/commentary` — Add one event

| Field | Type | Required | Notes |
|---|---|---|---|
| `message` | string | ✅ | Non-empty |
| `minute` / `minutes` | integer ≥ 0 | — | `minutes` is accepted as an alias |
| `sequence` | string or number | — | Parsed to integer, defaults `0` |
| `period` | string | — | e.g. `1H`, `2H`, `India innings` |
| `eventType` | string | — | Drives scoring and the UI badge |
| `actor` | string | — | |
| `team` | string | — | Must match `homeTeam` or `awayTeam` to affect the score |
| `metadata` | object | — | Stored as JSONB |
| `tags` | string[] | — | Stored as `text[]` |

The event is inserted, the match score is updated by the sport-specific delta, and both
`commentary` (to subscribers) and `match_updated` (to everyone) are broadcast.

```bash
curl -X POST http://localhost:8100/matches/42/commentary \
  -H 'Content-Type: application/json' \
  -d '{
    "minute": 67,
    "sequence": 12,
    "period": "2H",
    "eventType": "goal",
    "team": "Arsenal",
    "message": "GOAL! Arsenal take the lead"
  }'
```

`201 Created` → `{ "data": { ...commentaryRow } }`

### `POST /matches/:id/commentary/batch` — Bulk ingest

Accepts **1–100** entries. Inserts them in one query, aggregates all score deltas into a
single atomic match update, and broadcasts each inserted row.

```bash
curl -X POST http://localhost:8100/matches/42/commentary/batch \
  -H 'Content-Type: application/json' \
  -d '{
    "entries": [
      { "minute": 68, "eventType": "shot", "team": "Liverpool", "message": "Shot saved" },
      { "minute": 70, "eventType": "goal", "team": "Liverpool", "message": "GOAL! Liverpool equalise" }
    ]
  }'
```

`201 Created` → `{ "data": [ ...rows ], "match": { ...updatedMatch } }`

Returns `404` if the match does not exist.

---

## WebSocket API

**Endpoint:** `ws://<host>:<port>/ws` (or `wss://…/ws` behind TLS)

One connection per browser tab. The client receives a `welcome` frame immediately, then
sends subscriptions for the match it is viewing. Match-list events are broadcast to all
clients; commentary is scoped to subscribers.

### Client → Server

```json
{ "type": "subscribe",   "matchId": 42 }
{ "type": "unsubscribe", "matchId": 42 }
```

`matchId` must be an integer. Malformed JSON produces an `error` frame; unknown types are
ignored.

### Server → Client

| Type | Recipients | Payload |
|---|---|---|
| `welcome` | the new socket | `{}` |
| `subscribed` | the requesting socket | `{ "matchId": 42 }` |
| `unsubscribed` | the requesting socket | `{ "matchId": 42 }` |
| `match_created` | all clients | `{ "data": { ...match } }` |
| `match_updated` | all clients | `{ "data": { ...match } }` |
| `commentary` | subscribers of that match | `{ "data": { ...commentaryRow } }` |
| `error` | the requesting socket | `{ "message": "Invalid JSON" }` |

### Example client

```js
const ws = new WebSocket('ws://localhost:8100/ws');

ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', matchId: 42 }));

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  switch (message.type) {
    case 'welcome':        /* connection ready */ break;
    case 'commentary':     /* append message.data to the feed */ break;
    case 'match_created':
    case 'match_updated':  /* upsert message.data in the match list */ break;
  }
};
```

### Connection behavior

- **Heartbeat:** the server pings every 30s and terminates sockets that don't pong,
  reclaiming connections killed by sleep, NAT timeouts, or dropped Wi-Fi.
- **Reconnect:** the bundled React hook retries with exponential backoff
  (`1s, 2s, 4s, …` capped at `15s`) and resubscribes after `welcome`.
- **Limits:** max frame payload is **1 MB**; upgrades are rate-limited by Arcjet.
- **Cleanup:** disconnecting removes the socket from every subscription set.

---

## Data Model

### `matches`

| Column | Type | Constraints / Notes |
|---|---|---|
| `id` | `serial` | Primary key |
| `external_id` | `text` | **Unique**; upstream idempotency key (`espn:<league>:<event>`) |
| `sport` | `text` | Not null |
| `home_team`, `away_team` | `text` | Not null |
| `status` | `match_status` enum | `scheduled` \| `live` \| `finished`, default `scheduled` |
| `start_time`, `end_time` | `timestamp` | Used for status derivation and clocks |
| `home_score`, `away_score` | `integer` | Not null, default `0` — goals / points |
| `home_runs`, `home_wickets` | `integer` | Not null, default `0` — cricket |
| `away_runs`, `away_wickets` | `integer` | Not null, default `0` — cricket |
| `created_at` | `timestamp` | Not null, default `now()` |

### `commentary`

| Column | Type | Constraints / Notes |
|---|---|---|
| `id` | `serial` | Primary key; also used for client-side dedupe |
| `match_id` | `integer` | Not null, FK → `matches.id` |
| `minute` | `integer` | Nullable |
| `sequence` | `integer` | Not null; ordering within a period |
| `period` | `text` | e.g. `1H`, `2H`, `Q3`, `India innings` |
| `event_type` | `text` | Drives scoring and UI badges |
| `actor` | `text` | Player / official, optional |
| `team` | `text` | Owning team, optional |
| `message` | `text` | Not null |
| `metadata` | `jsonb` | Flexible event payload |
| `tags` | `text[]` | Free-form tags rendered as hashtags |
| `created_at` | `timestamp` | Not null, default `now()` |

**Why JSONB and `text[]`?** Commentary is heterogeneous — a goal has an assist, a wicket
has a batter — and JSONB avoids a migration for every new event shape. Fields that are
filtered or sorted (`match_id`, `event_type`, `team`) stay first-class columns.

---

## Live Data Ingestion

Source: ESPN's public (undocumented) JSON endpoints. No API key is required, and no
availability guarantee is implied.

| Sport | Endpoint |
|---|---|
| Football | `site.api.espn.com/apis/site/v2/sports/soccer/<league>/scoreboard` |
| Basketball | `site.api.espn.com/apis/site/v2/sports/basketball/<league>/scoreboard` |
| Cricket | `site.api.espn.com/apis/personalized/v2/scoreboard/header?sport=cricket&region=in&tz=Asia/Calcutta` |

**Leagues:** EPL, Bundesliga, La Liga, Serie A, Ligue 1, MLS, Brasileirão, Argentine
Primera, Liga MX, Eredivisie, Primeira Liga, NBA, WNBA.

### Pipeline

1. **Fetch** every 20s (`LIVE_FETCH_INTERVAL_MS`), with an in-flight guard preventing
   overlapping runs. A failing league is skipped; it never aborts the whole sync.
2. **Normalize** into one shape: teams, sport, status (`pre` → `scheduled`,
   `in` → `live`, `post` → `finished`), scores, and estimated end time.
3. **Upsert** by `external_id`:
   - unseen game → insert + broadcast `match_created`
   - changed game → update + broadcast `match_updated`
   - unchanged game → no write, no broadcast
4. **Backfill highlights** for finished matches that have no commentary yet.

### Cricket handling

Cricket doesn't fit a single score pair, so it has dedicated `runs`/`wickets` columns and
a parser for ESPN's score strings:

- `"198 & 51/2 (17 ov)"` → latest innings → **51 runs, 2 wickets**
- `"426"` → completed innings → **426 runs, 10 wickets**
- `"54/7 (7.4/8 ov, target 52)"` → **54 runs, 7 wickets**

### Generated highlights

ESPN provides final scores but not play-by-play. For finished matches, `summary.js`
builds a plausible feed that sums **exactly** to the final score:

- **Football** — kickoff, one entry per goal at random minutes with a running score,
  half-time, full-time, and a result line.
- **Basketball** — tipoff, 3/2/1-point plays that add up to each team's total, quarter
  breaks, final.
- **Cricket** — per-innings boundaries, singles, and wickets (≤ 10) that reconstruct the
  scorecard; long innings are clustered to avoid flooding the feed.

Generation is idempotent: it only runs when a match has **zero** commentary rows, so
repeated polling never duplicates entries.

---

## Scoring Rules

Scores are updated when commentary is created. Only events whose `team` matches
`home_team` or `away_team` affect the score.

| Sport | `eventType` | Score effect |
|---|---|---|
| Football | `goal`, `penalty` | +1 goal |
| Basketball | `basket` | +2 points |
| Basketball | `three` | +3 points |
| Basketball | `free_throw` | +1 point |
| Cricket | `six` | +6 runs |
| Cricket | `four`, `boundary` | +4 runs |
| Cricket | `run` | +1 run |
| Cricket | `wicket` | +1 wicket (capped at 10) |

Updates use SQL expressions — `home_score = home_score + 1` and
`LEAST(home_wickets + 1, 10)` — so concurrent requests cannot lose increments. The batch
endpoint aggregates all deltas and performs a single update.

---

## Frontend

The client is a single-page React app with two views, no router, and no global store.

### State flow

| Hook / handler | Responsibility |
|---|---|
| `useMatches` | Initial `GET /matches`, holds `matches`, `loading`, `error`; inserts on `match_created` |
| `useLiveSocket` | Owns the socket, reconnect/backoff, subscribe/unsubscribe, dispatches events |
| `onCommentary` | Appends to the feed, deduped by row `id` |
| `onMatchUpdated` | Patches the match in the list **and** in the open scoreboard |
| `onMatchCreated` | Prepends a new match if not already present |

### Details worth knowing

- **The socket is created once.** Callbacks and the selected `matchId` are kept in refs, so
  switching matches sends a `subscribe` frame instead of recreating the connection.
- **Status is derived defensively.** Persisted `live`/`finished` wins; otherwise status is
  computed from `startTime`/`endTime`. A 15-second tick keeps clocks and groupings fresh
  even when no socket event arrives.
- **Grouping:** Live now (sorted by start), Upcoming, Earlier (sorted by end, newest first).
- **Sport filter** options are generated from the loaded matches.
- **Cricket scores** render as `runs/wickets`; other sports render points.
- **Dev proxy:** Vite forwards `/matches` and `/ws` (with `ws: true`) to
  `http://localhost:8100`, so the browser sees a single origin and no CORS setup is needed.

### Production build

```bash
npm run build:client
# static assets in frontend/dist
```

Serve `frontend/dist` from any static host, CDN, or reverse proxy and forward `/matches`
and `/ws` to the Node backend.

---

## Security

[Arcjet](https://arcjet.com) protects both entry points:

| Surface | Rules | Limit |
|---|---|---|
| HTTP | Shield + bot detection + sliding window | **50 requests / 10s** |
| WebSocket upgrade | Shield + bot detection + sliding window | **5 upgrades / 2s** |

- Allowed bot categories are `SEARCH_ENGINE` and `PREVIEW`, so indexing and link previews
  still work.
- Denied HTTP requests get `429 Too Many Requests` (rate limit) or `403 Forbidden`;
  WebSocket denials are written as raw HTTP responses **before** the upgrade completes,
  which avoids allocating socket state for rejected clients.
- Arcjet failures return `503` rather than silently allowing traffic.
- `ARCJET_MODE=DRY_RUN` records decisions without blocking — useful for tuning rules
  before enforcement.
- Secrets (`DATABASE_URL`, `ARCJET_KEY`, the APM license key) are read from the
  environment and are git-ignored.

**Current scope:** the API is public and read-only by design. There is no
authentication/authorization, and rate limits are IP-based. Add auth and per-user quotas
before exposing admin/write routes publicly.

---

## Testing

```bash
npm test
```

The suite uses Node's built-in runner (`node --test`) and contains an end-to-end
integration test:

1. Spawns the real server on `127.0.0.1:8910`.
2. Polls `GET /` until it is ready.
3. Opens a real WebSocket connection (with a browser user-agent, since Arcjet's bot
   detection blocks the default Node UA).
4. Creates a match over HTTP and subscribes to it.
5. Posts a commentary entry and asserts a `commentary` frame with the right `matchId` and
   message arrives.
6. Cleans up the created rows and kills the process in `t.after`.

**Requirements:** a reachable `DATABASE_URL`, a valid `ARCJET_KEY`, and `.env` loaded.
The test writes to the configured database (and cleans up after itself), so do not point
it at production.

---

## Operations

- **Graceful shutdown:** `SIGINT` / `SIGTERM` clears both intervals, terminates WebSocket
  clients, closes the HTTP server, and closes remaining connections.
- **Timers are `unref()`'d**, so scripts and tests can exit without being held open.
- **Ingestion safety:** in-flight guard, per-league error isolation, and idempotent
  upserts mean restarts and upstream failures are survivable.
- **Config without redeploys:** every interval and seed behavior is environment-tunable.
- **APM:** `apminsight` is imported before the app and reads `apminsightnode.json` from the
  working directory. Missing config logs a warning and the app continues.
- **Logging:** prefixed messages such as `[live] 124 games (3 new, 41 updated)` and
  `Match status sync failed` make logs greppable.

### Deployment checklist

- [ ] Set `DATABASE_URL`, `ARCJET_KEY`, `ARCJET_MODE=LIVE`, and `NODE_ENV=production`.
- [ ] Run migrations (`npm run db:migrate`) — never `db:push`.
- [ ] Build the frontend (`npm run build:client`) and serve `frontend/dist` statically.
- [ ] Reverse-proxy `/matches` and `/ws` to the Node process, with WebSocket upgrade
      headers enabled (`Upgrade` / `Connection`).
- [ ] Run a **single** backend instance, or add shared pub/sub before scaling horizontally
      (see limitations).
- [ ] Do not commit `.env` or `apminsightnode.json`.

---

## Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| `ARCJET_KEY environment variable is missing.` | Add `ARCJET_KEY` to `.env`. The app fails fast by design. |
| `DATABASE_URL is not defined in .env` | Add the connection string; it is required. |
| Frontend shows "No matches" and the proxy logs `ECONNREFUSED` | Backend isn't on the port Vite expects. Set `PORT=8100` or change the proxy target in `frontend/vite.config.js`. |
| WebSocket stays on "Reconnecting" | Backend down, wrong port, proxy doesn't forward upgrades, or Arcjet blocked the upgrade (check `ARCJET_MODE` and server logs). |
| `429` / `403` when connecting a script | Arcjet rate limit or bot detection. Use a browser-like user-agent in tests, or set `ARCJET_MODE=DRY_RUN` while developing. |
| Live scores never appear | `site.api.espn.com` unreachable, or the upstream shape changed. Check `[live]` logs; the seeder can provide demo data offline. |
| Database connection errors in this repo | `src/db/index.js` pins the Neon host (`NEON_HOST`) and overrides `globalThis.fetch`. Update the host for your database or remove the workaround. |
| Seeder fails with `API_URL is required` | Provide `API_URL` (e.g. `http://localhost:8100`). |
| Seeder stops early | It streams only while matches are within their live window; finished matches are ingested in batches first. Check the console output. |
| APM warning about `apminsightnode.json` | Optional. Create the config file with your Site24x7 key, or ignore the warning/remove the agent import. |

---

## Known Limitations & Roadmap

**Limitations**

1. **Single-instance fan-out.** Subscriptions live in process memory. Multiple backend
   instances require shared pub/sub, otherwise a client only sees events produced by the
   instance it connected to.
2. **No event replay.** A reconnecting client refetches over REST and resubscribes, so it
   converges, but events during the gap can be missed.
3. **No backpressure handling.** `socket.send` is fire-and-forget; a very slow client can
   accumulate buffered data. A `bufferedAmount` check or per-socket queue would fix this.
4. **No authentication.** Subscriptions and writes are anonymous.
5. **Undocumented data source.** ESPN's endpoints have no contract and can change without
   notice; ingestion degrades gracefully but cannot guarantee completeness.
6. **Environment-specific DB workaround.** `src/db/index.js` pins a Neon host and
   monkey-patches `globalThis.fetch`. It is documented, but it is still a hack — a
   dependency-injected DB client is the correct long-term fix.
7. **Test coverage** is one end-to-end path; pure functions and failure paths are not yet
   unit-tested, and there is no CI pipeline.

**Roadmap**

- Redis (or Postgres `LISTEN/NOTIFY`) pub/sub for horizontal scaling
- Per-match sequence numbers + a catch-up endpoint for lossless reconnects
- TypeScript migration and shared API/event types
- Unit tests for parsers, scoring, status derivation, and highlight generation; CI via
  GitHub Actions
- Database indexes on `commentary(match_id, created_at)`
- Socket backpressure handling and connection caps
- Authentication for write endpoints
- Compression and load testing (`autocannon` / `k6`)

---

## Contributing

1. Fork the repository and create a feature branch
   (`feat/your-feature` or `fix/your-bug`).
2. Keep changes consistent with the existing structure: validation in `src/validation`,
   pure helpers in `src/utils`, integrations in `src/live`.
3. Run `npm test` and `npm --prefix frontend run lint` before opening a PR.
4. Describe the change, the motivation, and any operational impact.

Suggestions and issues are welcome at
[github.com/itsXILO/LiveWire/issues](https://github.com/itsXILO/LiveWire/issues).

---

## License

ISC — see `package.json`.

---

## Acknowledgements

- [ESPN](https://www.espn.com/) for the public scoreboard endpoints
- [`ws`](https://github.com/websockets/ws), [Express](https://expressjs.com/),
  [Drizzle ORM](https://orm.drizzle.team/), [Neon](https://neon.tech),
  [Arcjet](https://arcjet.com/), [Zod](https://zod.dev/), [Vite](https://vite.dev/),
  and [React](https://react.dev/)
- [Site24x7 APM Insight](https://www.site24x7.com/) for application monitoring
