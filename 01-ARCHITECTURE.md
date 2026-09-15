# KSPDB Fault Localization Engine — Architecture

> **Accuracy guarantee**: every claim in this document is verifiable against a
> specific file and line in this repository. File paths are listed inline.
> Numbers come from measured benchmarks, not estimates.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Repository Layout](#2-repository-layout)
3. [Service Topology (Runtime)](#3-service-topology-runtime)
4. [Data Model](#4-data-model)
5. [Telemetry Ingestion Pipeline](#5-telemetry-ingestion-pipeline)
6. [Localization Engine](#6-localization-engine)
7. [Topology Service](#7-topology-service)
8. [Confidence Rules Engine](#8-confidence-rules-engine)
9. [Ticket & Lifecycle Management](#9-ticket--lifecycle-management)
10. [Simulator](#10-simulator)
11. [AI Explainer (Optional)](#11-ai-explainer-optional)
12. [Frontend](#12-frontend)
13. [Tunable Constants](#13-tunable-constants)
14. [Known Failure Cases & Limitations](#14-known-failure-cases--limitations)
15. [Measured Performance](#15-measured-performance)

---

## 1. System Overview

The KSPDB Fault Localization Engine automatically detects, localizes, and
classifies power outages across a low-tension (LT) distribution grid of ~4,000
poles in Karnataka, India. It operates as a real-time event-driven pipeline:

```
IoT Devices -> POST /telemetry -> telemetry_inbox queue
                                         |
                              Ingestion Worker (polling)
                                         |
                                PoleState derivation
                                         |
                            Localization Engine (per-DT)
                                         |
                                Incident + Ticket sync
                                         |
                              React Dashboard (5s polling)
```

The system **does not** operate in real-time on the grid. A built-in
**Simulator** injects synthetic faults to drive the pipeline, acting as a
stand-in for real IoT devices during development and demo.

---

## 2. Repository Layout

```
Fault_Localization/
|-- apps/
|   |-- backend/                  Node.js / Fastify API + Worker
|   |   |-- prisma/schema.prisma  Database schema (PostgreSQL)
|   |   `-- src/
|   |       |-- app.js            Fastify factory - route registration
|   |       |-- index.js          HTTP server entry (PORT=3000)
|   |       |-- ai/               AI incident explainer (Anthropic)
|   |       |-- localization/     Fault localization engine (pure functions)
|   |       |-- routes/           HTTP route handlers
|   |       |-- scheduled-outages/ Overlap detection adapter
|   |       |-- scripts/          Seed, ground-truth, registry export
|   |       |-- simulator/        Heartbeat emitter + fault ground truth
|   |       |-- tickets/          Ticket lifecycle + restoration verifier
|   |       |-- topology/         Authoritative + inferred topology builders
|   |       `-- worker/           Ingestion worker + sweeper + run.js
|   `-- frontend/                 React SPA served via nginx
|       `-- src/
|           |-- App.jsx           Layout, sidebar navigation
|           |-- components/       MapView, IncidentList, IncidentDetail
|           `-- pages/            SimulatorPanel, IncidentHistoryPanel, ...
|-- packages/
|   `-- domain/src/
|       |-- schemas.js            Zod domain schemas (shared validation)
|       |-- thresholds.js         All numeric constants (single source of truth)
|       `-- types.js              TypeScript-style JSDoc type definitions
|-- scripts/
|   `-- load-test.js              Telemetry ingestion benchmark (Step 33)
|-- docs/
|   |-- api-contract.md           REST API contract
|   |-- ARCHITECTURE.md           This file (copy in /docs)
|   `-- benchmark-results.md      Measured throughput numbers
`-- docker-compose.yml            Four-service production deployment
```

---

## 3. Service Topology (Runtime)

Four Docker services communicate over a shared Docker network:

```
+-------------------------------------------------------------+
|                     Docker Network                          |
|                                                             |
|  +----------+  TCP 5432  +------------------------------+  |
|  | postgres | <----------| backend                      |  |
|  |  :5432   |            | Fastify, Node.js :3000       |  |
|  +----------+            | prisma migrate + seed        |  |
|       ^                  +------------------------------+  |
|       | TCP 5432                        ^                   |
|  +----+------------------+      HTTP :3000                  |
|  | worker                |              |                   |
|  | ingestion loop        |       +------+------+            |
|  | sweeper               |       | frontend    |            |
|  | heartbeat emitter     |       | nginx :80   |            |
|  +-----------------------+       +-------------+            |
+-------------------------------------------------------------+
         ^ host:5432          ^ host:3000      ^ host:80
         (dev inspect)        (API)            (UI)
```

**Startup order** (enforced by `depends_on` + healthchecks in `docker-compose.yml`):

1. `postgres` — waits until `pg_isready` passes (up to 10 retries x 5s).
2. `backend` — depends on `postgres: service_healthy`. Runs `prisma migrate deploy` then `seed.js` before starting Fastify. Reports healthy when `GET /health` returns 200.
3. `worker` — depends on `backend: service_healthy`. Starts the ingestion loop, sweeper, and heartbeat emitter.
4. `frontend` — depends on `backend: service_started`. nginx proxies `/api/*` to `http://backend:3000`.

---

## 4. Data Model

Schema: `apps/backend/prisma/schema.prisma`

### Core Tables

| Table | Purpose |
|---|---|
| `feeders` | Top-level grid subdivision (11 kV feeder) |
| `transformers` | Distribution transformers (DT). `topology_source`: `RECORDED` or `MISSING`. |
| `poles` | Individual poles under a DT. `device_id` is null for ~9% unmonitored poles. |
| `devices` | IoT sensors. `last_seen` is the heartbeat timeout anchor. |
| `topology_edges` | Parent/child relationships. `source`: `AUTHORITATIVE` or `INFERRED`. `ambiguous=true` when an alternative MST parent is within 15% weight. |
| `pole_states` | Current derived status per pole: `LIVE`, `CONFIRMED_DARK`, `STALE`, `OFFLINE_UNKNOWN`, `SENSOR_SUSPECT`. |
| `telemetry_inbox` | Queue table. `PENDING` to `PROCESSED`. Claimed with `FOR UPDATE SKIP LOCKED`. |
| `incidents` | A localized fault event. `type`: `SPAN`, `DT`, `FEEDER`, `RANGE`. |
| `tickets` | One ticket per incident. `DETECTED` to `ACKNOWLEDGED` to `CREW_ASSIGNED` to `RESOLVED` to `VERIFIED` to `CLOSED`. |
| `scheduled_outages` | Planned maintenance windows. Reduces confidence score; never suppresses detection. |
| `simulator_faults` | Active injected faults. `repaired_at = null` means currently active. |
| `sim_true_topology` | Ground-truth parent/child for MISSING-topology DTs. Invisible to the localization engine. |

### Key Enumerations

```
PoleStatus:      LIVE | CONFIRMED_DARK | STALE | OFFLINE_UNKNOWN | SENSOR_SUSPECT
TelemetryEvent:  heartbeat | power_lost | power_restored | boot
IncidentType:    SPAN | DT | FEEDER | RANGE
ConfidenceLevel: HIGH | MEDIUM | LOW
TicketState:     DETECTED | ACKNOWLEDGED | CREW_ASSIGNED | RESOLVED | VERIFIED | CLOSED
TopologySource:  AUTHORITATIVE | INFERRED
```

---

## 5. Telemetry Ingestion Pipeline

### 5.1 HTTP Ingestion (POST /telemetry)

File: `apps/backend/src/routes/telemetry.js`

Validates payload against `TelemetryIngestSchema` (Zod) and inserts one row
into `telemetry_inbox` with `status = 'PENDING'`. Returns `202 Accepted`
immediately. No business logic executes in this hot path.

```
POST /telemetry
  -> Zod validation (TelemetryIngestSchema)
  -> prisma.telemetryInbox.create({ status: 'PENDING' })
  -> 202 { status: 'accepted', id: <uuid> }
```

**Required payload fields**:

| Field | Type | Notes |
|---|---|---|
| `device_id` | string | IoT device identifier |
| `pole_id` | string | Pole the device is mounted on |
| `event` | enum | heartbeat, power_lost, power_restored, boot |
| `energized` | boolean | Live voltage present at the device |
| `device_ts` | ISO datetime | Device-local timestamp |
| `seq` | integer | Monotonic sequence number per device |
| `fw` | string | Firmware version (affects timeout strategy) |
| `battery_mv` | integer | Optional |
| `rssi` | integer | Optional |
| `server_received_at` | ISO datetime | Optional; defaults to server time |

### 5.2 Ingestion Worker

File: `apps/backend/src/worker/ingestion-worker.js`

Runs in its own container. The main loop (in `run.js`) calls
`processNextTelemetryEvent()` continuously: 10 ms poll interval when the queue
has items; 1 s idle interval when empty.

**Per-event processing — all steps in a single Postgres transaction:**

1. `SELECT id FROM telemetry_inbox WHERE status='PENDING' ORDER BY server_received_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`
   Claims one row atomically. Concurrent workers cannot claim the same row.
2. Fetch full row + current PoleState + Device record for the pole.
3. Call `processEvent(currentState, event)` — pure function, no I/O.
4. Call `evaluateTimeout(newState, device, now)` — may immediately confirm dark if stale.
5. Upsert `PoleState` if state changed.
6. If the pole's DT is known: call `runLocalizationForDt(dtId, tx)`.
7. Call `syncIncidents(incidents, dtId, tx)` to persist/update incidents.
8. Update `device.last_seen` to the event's `server_received_at`.
9. Mark inbox row `PROCESSED`.

If the transaction throws, it rolls back. The row stays `PENDING` and is
retried on the next poll. The `SIMULATE_CRASH=1` env var triggers a deliberate
crash mid-transaction for crash-recovery integration tests.

### 5.3 Heartbeat Timeout Sweeper

File: `apps/backend/src/worker/sweeper.js`

Runs every **5 seconds** inside the worker process. Two checks:

1. **Debounce completion**: Finds all PoleState rows with `status=LIVE` and
   `candidate_dark_since IS NOT NULL`. Calls `evaluateTimeout()` — if 90 s has
   elapsed, transitions to `CONFIRMED_DARK`.

2. **Heartbeat timeout**: Finds all Device rows with
   `last_seen < now - 32 min`. For poles with `status=LIVE`, calls
   `evaluateTimeout()` — transitions to `CONFIRMED_DARK`.

After state changes, runs `runLocalizationForDt` once per affected DT.
The sweeper double-checks inside its transaction to guard against races.

---

## 6. Localization Engine

All localization logic is **pure** (no DB calls, no side effects) except the
orchestrator which is the only DB-aware coordinator.

```
apps/backend/src/localization/
|-- orchestrator.js    DB-aware coordinator; fetches state, calls pure fns
|-- pole-state.js      PoleState state machine (PURE)
|-- frontier.js        Span-level boundary detection (PURE)
|-- rollup.js          DT/Feeder rollup rules (PURE)
|-- range.js           RANGE incident expansion (PURE)
|-- confidence.js      Confidence rules engine (PURE)
`-- incident-sync.js   Idempotent incident persistence (DB-aware)
```

### 6.1 PoleState Derivation (pole-state.js)

Two pure functions implementing Section H Rules 1-6:

**processEvent(currentState, event)** — event-driven transitions:

| Rule | Trigger | Effect |
|---|---|---|
| Rule 1 | seq <= last_event_seq (not boot) | Discard (dedup/reorder protection) |
| Rule 3 | power_restored or heartbeat(energized=true) | status=LIVE, clear candidate_dark_since |
| Rule 2 | power_lost or heartbeat(energized=false) | Set candidate_dark_since if not already set |
| — | boot | Update evidence only |

**evaluateTimeout(currentState, device, currentTime)** — time-driven transitions:

| Rule | Trigger | Effect |
|---|---|---|
| Rule 6 | candidate_dark_since set AND elapsed >= DEBOUNCE_MS (90 s) | status=CONFIRMED_DARK |
| Rule 4 | device.last_seen AND silence >= HEARTBEAT_TIMEOUT_MS (32 min) | status=CONFIRMED_DARK, evidence_type=timeout_fw13 or timeout_fw12 |

### 6.2 Frontier Detection (frontier.js)

Implements the topmost boundary detection algorithm. Given a flat edge list for
a DT subtree and a map of pole states, it performs a **top-down recursive walk**
from each root pole to produce frontier edges.

**A frontier edge** is a parent-to-child span where:
- The parent side is *effectively LIVE* (LIVE, unmonitored/assumed-live, or sensor-suspect), AND
- The child subtree contains at least one CONFIRMED_DARK pole, AND
- The child itself is not effectively LIVE.

**Rule 3 (collapse)**: Once a frontier edge is emitted, the entire dark subtree
is marked collapsed. The walk does not descend further — only the topmost
boundary edge is emitted per dark branch.

**Rule 4 (sensor suspect)**: A CONFIRMED_DARK pole with a LIVE descendant
(confirmed within 1 s clock-skew grace of the dark timestamp) violates the
radial power-flow invariant. Flagged SENSOR_SUSPECT; treated as effectively
live for the walk.

**Rule 7 (range edges)**: Any frontier edge where either endpoint has
`device_id = null` is also recorded in `rangeEdges` with
`missing_side: 'parent' | 'child' | 'both'`.

### 6.3 DT and Feeder Rollup (rollup.js)

**DT Rollup (Rule 5)**: If >= ROLLUP_THRESHOLD (90%) of *monitored* poles under
a DT are CONFIRMED_DARK and no LIVE pole exists, emit a single DT_FAULT. The
90% threshold excludes the ~9% unmonitored poles from both numerator and
denominator.

**Feeder Rollup (Rule 6)**: Same logic across all DTs on a feeder. If >= 90%
of feeder-wide monitored poles are dark, emit a FEEDER_FAULT. DT-level
incidents for that feeder are superseded.

**Correlation window**: Both rollups require all dark events to fall within
CORRELATION_WINDOW_MS (5 minutes) to avoid rolling up unrelated sequential
faults.

### 6.4 RANGE Incident Expansion (range.js)

When a frontier edge has an unmonitored endpoint, `expandRangeIncident()`
walks the topology tree to bound the fault:

- `upstream_live_pole_id`: nearest monitored LIVE ancestor.
- `downstream_dark_pole_ids`: first monitored CONFIRMED_DARK descendants.
- `unmonitored_pole_ids`: all unmonitored poles in the bounded gap.
- `gap_pole_count`: total poles in the gap.

RANGE incidents with `gap_pole_count > RANGE_LOW_CONFIDENCE_POLE_CUTOFF (10)`
are immediately classified LOW confidence.

### 6.5 Orchestrator (orchestrator.js)

The only DB-aware component in the localization engine:

1. Fetches poles, edges, devices, pole states for the triggering DT.
2. If a feeder ID is available, fetches the full feeder scope for rollup.
3. Calls `detectFrontier()` then `evaluateDtRollup()` / `evaluateFeederRollup()` then `applyRollup()`.
4. For each incident: `checkScheduledOutageOverlap()` then `buildConfidenceEvidence()` + `evaluateConfidence()`.
5. Groups multiple SPAN incidents sharing the same `upstream_live_pole_id` into a single merged incident (lowest confidence wins).
6. Returns `{ incidents, sensorSuspects }` — never writes to DB.

### 6.6 Incident Sync (incident-sync.js)

Idempotently persists localization output:

- For each computed incident, search all active (non-VERIFIED, non-CLOSED) incidents
  for **pole ID intersection** with the new incident's `affected_pole_ids`.
- If an overlapping incident exists: update it (merge affected poles into
  `historical_affected_pole_ids`, update confidence/type, update existing ticket).
- If no overlap: create a new incident and a new DETECTED ticket.
- Incidents with no matching computed counterpart are not auto-closed here;
  that is handled by the restoration verifier.

---

## 7. Topology Service

Files: `apps/backend/src/topology/authoritative.js`, `inferred.js`

### Authoritative Topology

Used when a DT has `topology_source = 'RECORDED'`. Builds TopologyEdge rows
from the `parent_pole_id` field already stored on poles. All edges get
`source = 'AUTHORITATIVE'` and `ambiguous = false`.

### Inferred Topology — MST Heuristic

Used when a DT has `topology_source = 'MISSING'`. Runs a
**degree-constrained Minimum Spanning Tree** on haversine GPS distances:

1. Find the pole nearest to the DT lat/lon — this is the MST root.
2. Grow the MST using Prim's algorithm, capping each pole to at most
   MST_MAX_DEGREE (4) children.
3. If a pole cannot be connected within the degree cap, fall back to a
   longer-distance edge via Dijkstra.
4. Any edge where an alternative parent is within MST_AMBIGUITY_TOLERANCE (15%)
   of the chosen weight is flagged `ambiguous = true`.

All inferred edges have `source = 'INFERRED'`. The confidence engine will
downgrade incident confidence for any incident that relies on these edges.

**Topology is built at seed time** and stored in `topology_edges`. It is not
recomputed per request.

---

## 8. Confidence Rules Engine

File: `apps/backend/src/localization/confidence.js`

Pure function: `evaluateConfidence(evidence) -> { level: HIGH|MEDIUM|LOW, reasons[] }`

Evidence is assembled by `buildConfidenceEvidence()` from the frontier edge,
optional range incident, sensor suspects, scheduled outage overlap flag, and
per-pole evidence types (`evidence_type` on PoleState).

### Rule Precedence: LOW beats MEDIUM; MEDIUM beats HIGH

**Conditions that force LOW** (checked first; any one is sufficient):

| Reason Code | Condition |
|---|---|
| `INFERRED_AMBIGUOUS` | topology_source=INFERRED AND any edge in the path is ambiguous=true |
| `RANGE_TOO_LARGE` | RANGE incident with gap_pole_count > 10 |
| `FW12_TIMEOUT_ONLY` | All dark evidence from fw<1.3 heartbeat silence only (no power_lost) |
| `SENSOR_SUSPECT_PRESENT` | Any SENSOR_SUSPECT pole in the affected subtree |

**Conditions that force MEDIUM** (if no LOW fired):

| Reason Code | Condition |
|---|---|
| `INFERRED_TOPOLOGY` | topology_source=INFERRED (non-ambiguous) |
| `MISSING_DEVICE_GAP` | RANGE incident OR unmonitored gap pole |
| `HEARTBEAT_TIMEOUT_EVIDENCE` | CONFIRMED_DARK came from timeout, not explicit power_lost |
| `SCHEDULED_OUTAGE_OVERLAP` | Active scheduled outage overlaps the incident area/time |

**Result is HIGH** if no LOW or MEDIUM conditions fired:
- AUTHORITATIVE topology, directly monitored boundary poles, explicit power_lost
  evidence, no outage overlap.

---

## 9. Ticket & Lifecycle Management

### Ticket State Machine

```
DETECTED -> ACKNOWLEDGED -> CREW_ASSIGNED -> RESOLVED -> VERIFIED -> CLOSED
```

Transitions are validated in `apps/backend/src/tickets/service.js`.
Invalid transitions (e.g. VERIFIED -> ACKNOWLEDGED) are rejected with a 400.

### Restoration Verifier

File: `apps/backend/src/tickets/restoration-verifier.js`

The worker calls `runRestorationVerifier()` every **15 seconds**. For every
ticket in `RESOLVED` state it checks whether all monitored poles in
`incident.affected_pole_ids` have `pole_state.status = 'LIVE'`. Tickets that
have not yet been marked `RESOLVED` by a crew (`DETECTED`, `ACKNOWLEDGED`,
`CREW_ASSIGNED`) are left untouched — restoration is confirmed, not decided,
by telemetry.

- Unmonitored poles (no pole_state row) are **skipped** — absence of evidence
  is not evidence of darkness.
- All monitored poles LIVE: auto-transition to VERIFIED.
- Any pole still dark: update `ticket.still_dark_pole_ids` and leave ticket in
  current state for operator review.

### Scheduled Outage Overlap

File: `apps/backend/src/scheduled-outages/adapter.js`

`checkScheduledOutageOverlap()` queries `scheduled_outages` for any active
window covering the incident's affected poles (by DT, feeder, or span scope),
applying a SCHEDULED_OUTAGE_OVERRUN_BUFFER_MS (40 min) extension past the
scheduled end time.

A positive overlap **does not suppress incident generation or ticket creation**.
It sets `incident.scheduled_outage_overlap = true` and causes the confidence
engine to emit `SCHEDULED_OUTAGE_OVERLAP` (-> MEDIUM confidence).

---

## 10. Simulator

Files: `apps/backend/src/simulator/`

Scoped entirely to the `worker` container. The localization engine and API
routes have no dependency on simulator code.

### Ground-Truth Network Generator (generate-ground-truth.js)

Generates a synthetic ~4,000-pole network in-memory at seed time:

- 5 feeders, multiple DTs per feeder, ~20-30 poles per DT.
- ~70% of DTs have `topology_source: RECORDED` (authoritative parent links stored).
- ~30% of DTs have `topology_source: MISSING` (parent_pole_id stripped in registry export).
- `sim_true_topology` table stores real parent/child for MISSING DTs — used
  only by the simulator for fault propagation. The localization engine never
  reads this table.

### Heartbeat Emitter (heartbeat-emitter.js)

Emits `heartbeat(energized=true)` via `POST /telemetry` for every healthy
device every **10 minutes** (HEARTBEAT_EMIT_INTERVAL_MS). Devices under an
active SimulatorFault are skipped. All emissions go through the real HTTP
endpoint — no direct DB writes. This keeps `device.last_seen` fresh,
preventing the sweeper from timing out healthy poles.

### Fault Injection (POST /api/simulator/fault)

Fault types: SPAN (one pole's subtree), DT (all poles under a transformer),
FEEDER (all poles on a feeder).

Injection steps:
1. Insert SimulatorFault row.
2. Heartbeat emitter begins skipping affected poles.
3. Sweeper detects silence after HEARTBEAT_TIMEOUT_MS (32 min) and sets CONFIRMED_DARK.
4. Localization engine runs per-DT, emits incident + ticket.

Fault repair (DELETE /api/simulator/fault/:id): sets repaired_at, emitter
resumes, power_restored events are posted, restoration verifier auto-verifies
once all poles return LIVE.

---

## 11. AI Explainer (Optional)

File: `apps/backend/src/ai/explain.js`

Triggered when `GET /api/incidents/:id` is called and `ANTHROPIC_API_KEY` is set.

Calls `claude-3-haiku-20240307` with a structured prompt to produce a single
paragraph summary of the incident for a human operator. Strict prompt rules
prohibit hallucinating physical details not present in the incident JSON.

**Constraints:**
- 3-second hard timeout via AbortController (AI_EXPLAINER_TIMEOUT_MS).
- Falls back to `generateTemplateExplanation()` (deterministic, no API) on
  timeout, HTTP error, or missing API key.
- max_tokens: 150 (single paragraph).
- The fallback produces the same UI layout; only the "AI-enhanced" badge differs.

**Do not enable in production without a data-handling review** — the full
incident JSON (including pole IDs and coordinates) is sent to Anthropic's API.

---

## 12. Frontend

Technology: React (Vite), Leaflet (maps), lucide-react (icons), vanilla CSS.
Served by nginx; nginx proxies `/api/*` to `http://backend:3000`.

### Pages

| Page | Nav State | Key Component |
|---|---|---|
| Network Map | network-map | MapView.jsx — Leaflet map, poles colored by status |
| Simulator | simulator | SimulatorPanel.jsx — fault injection/repair UI |
| Scheduled Outages | scheduled-outages | CRUD for maintenance windows |
| Incident History | history | IncidentHistoryPanel.jsx — verified/closed log |
| Settings | settings | — |

### Live Update Strategy

The frontend polls `GET /api/map/poles` and `GET /api/incidents` every **5
seconds**. There is no WebSocket — polling was chosen for simplicity in the
demo environment.

### Pole Colors on Map

| Color | Pole Status |
|---|---|
| Green | LIVE |
| Red | CONFIRMED_DARK |
| Orange | SENSOR_SUSPECT |
| Gray | STALE / OFFLINE_UNKNOWN / no state recorded |

---

## 13. Tunable Constants

All numeric thresholds: `packages/domain/src/thresholds.js`

No bare literals representing these values appear anywhere else in the codebase.

| Constant | Value | Rationale |
|---|---|---|
| `DEBOUNCE_MS` | 90,000 ms (90 s) | Covers NTP skew + LTE transmission lag before confirming dark |
| `HEARTBEAT_TIMEOUT_MS` | 1,920,000 ms (32 min) | Two missed 15-min heartbeats + 2-min buffer for jitter |
| `FW_LEGACY_THRESHOLD` | '1.3' | Firmware below this never sends power_lost events |
| `ROLLUP_THRESHOLD` | 0.90 (90%) | DT/Feeder rollup trigger; accommodates ~9% unmonitored gap |
| `CORRELATION_WINDOW_MS` | 300,000 ms (5 min) | Max window to correlate events as a single fault |
| `MST_MAX_DEGREE` | 4 | Maximum children per pole in inferred MST |
| `MST_AMBIGUITY_TOLERANCE` | 0.15 (15%) | Alternative parent within 15% weight flags edge as ambiguous |
| `RANGE_LOW_CONFIDENCE_POLE_CUTOFF` | 10 | RANGE gap > 10 poles forces LOW confidence |
| `SCHEDULED_OUTAGE_OVERRUN_BUFFER_MS` | 2,400,000 ms (40 min) | Overlap check extends 40 min past scheduled end |
| `AI_EXPLAINER_TIMEOUT_MS` | 3,000 ms (3 s) | Hard abort for Anthropic API; fallback on timeout |

---

## 14. Known Failure Cases & Limitations

Real, known limitations — not theoretical risks.

### 14.1 Heartbeat Timeout Is Slow by Design

A device that silently loses power without sending `power_lost` is only
detected after HEARTBEAT_TIMEOUT_MS = 32 minutes. The dashboard can be up to
**32 minutes late** detecting a fault on a fw<1.3 device or a device that
dropped its power_lost message.

Mitigation: fw>=1.3 devices send explicit power_lost events, which trigger the
90-second debounce path instead.

### 14.2 Inferred Topology Can Be Wrong

The MST heuristic follows straight-line GPS distance, not road easements. For
MISSING-topology DTs (~30% of the network), the inferred tree may not match
the actual cable routing. The confidence engine downgrades to MEDIUM or LOW,
but the topology will be incorrect for some poles.

The `ambiguous` flag on edges indicates where uncertainty is highest.

### 14.3 Single-Worker, No Parallelism

The ingestion worker is a single process with a sequential event loop. The
`FOR UPDATE SKIP LOCKED` mechanism supports horizontal scaling, but only one
worker is currently deployed. Sustained rates above ~907 req/s (measured burst
limit) will cause backlog growth.

Mitigation: scale the `worker` service in docker-compose.yml. No code changes
required.

### 14.4 Incident Idempotency Is Approximate

incident-sync.js matches incidents by `affected_pole_ids` intersection. If a
fault evolves so that two formerly separate incidents share poles, the sync
merges them. Simultaneous faults on adjacent subtrees can produce unexpected
merges in edge cases.

### 14.5 Restoration Verifier Scales Linearly

`runRestorationVerifier()` fetches all non-terminal tickets every 15 seconds
and checks each one. With many simultaneous active tickets this scan grows
linearly. Acceptable at 4,000-pole demo scale; would need indexing and batching
for production scale.

### 14.6 Scheduled Outage Does Not Suppress Tickets

A scheduled outage lowers confidence but does not prevent ticket generation.
Operators see a ticket for a planned outage. The `scheduled_outage_overlap`
field provides context, but operators must manually close or ignore the ticket.

### 14.7 AI Explainer Sends Grid Data to Third Party

With ANTHROPIC_API_KEY configured, the full incident JSON (pole IDs, grid
coordinates) is sent to Anthropic's API. Do not enable in production without
a data-handling review.

---

## 15. Measured Performance

Benchmark script: `scripts/load-test.js`
Full results: `docs/benchmark-results.md`

Tested against the Docker stack on local hardware (Windows host, Docker
Desktop), 2026-08-05.

| Test | Target | Actual | Zero Failures |
|---|---|---|---|
| Sustained load (10 s) | 500 req/s | **500.00 req/s** | Yes |
| Burst load (5,000 total) | < 10 s | **5.51 s / 907 req/s** | Yes |

**What is measured**: HTTP acceptance at `POST /telemetry` plus insertion into
`telemetry_inbox`. This does **not** include end-to-end latency from telemetry
arrival to incident appearing on the dashboard (which additionally includes
worker poll time + localization runtime + 5-second UI poll interval).

---


