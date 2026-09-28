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
| `feeders` | 11 kV feeder. `substation` names its source; `route` is the trunk as `[[lat, lon], ...]` from the substation outward (drawn on the map, used to pin FEEDER faults). |
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

**Per-event processing, all steps in a single Postgres transaction:**

1. Claim one row with `FOR UPDATE SKIP LOCKED`, ordered `power_lost` first,
   then `power_restored`, then everything else, oldest first within each. A
   feeder-wide burst of alarms is therefore processed ahead of routine heartbeats.
2. Fetch the full row and the pole's current PoleState.
3. Call `processEvent(currentState, event)`: pure function, no I/O.
4. Call `evaluateTimeout(newState, null, now)`: resolves the 90 s debounce
   inline if it has already elapsed. No device is passed, so the heartbeat-timeout
   rule is left to the sweeper: an event proves liveness at its
   `server_received_at`, and one that sat in an inbox backlog must not darken a
   healthy pole.
5. Upsert `PoleState` if anything changed.
6. Only if the **status** changed and the pole has a DT:
   - to a dark status: `runLocalizationForDt(dtId, tx)` then `syncIncidents(...)`;
   - to `LIVE`: the DT is added to an in-memory set and re-localized once after
     the next sweep (`relocalizeRestoredDts()` in `run.js`). A feeder repair
     produces hundreds of LIVE transitions; re-localizing per event would stall
     the queue.
   Candidate-only changes and plain heartbeats never trigger localization.
7. Update `device.last_seen` to the event's `server_received_at`.
8. Mark the inbox row `PROCESSED`.

If the transaction throws, it rolls back. The row stays `PENDING` and is
retried on the next poll. The `SIMULATE_CRASH=1` env var triggers a deliberate
crash mid-transaction for crash-recovery integration tests.

### 5.3 Heartbeat Timeout Sweeper

File: `apps/backend/src/worker/sweeper.js`

Runs every **5 seconds** inside the worker process; a new sweep is skipped
while the previous one (plus the restored-DT re-localization that follows it)
is still running. Two checks, both batched:

1. **Debounce completion**: PoleState rows with `status=LIVE` and
   `candidate_dark_since` set, older than 90 s, become `CONFIRMED_DARK`.

2. **Heartbeat timeout**: devices whose `last_seen` is older than 32 min
   (`HEARTBEAT_TIMEOUT_MS`) have their LIVE pole confirmed dark.

**Listening window.** Silence only counts while the worker was actually
listening. `listeningSince` is the worker start time, reset whenever two
sweeps are more than 2 minutes apart (host sleep, container pause). Each
device's effective last-seen is `max(last_seen, listeningSince)`, so a restart
or a laptop waking up does not time out the whole network at once.

**Race safety.** Each pole is confirmed with a compare-and-set
(`updateMany where { status: 'LIVE', candidate_dark_since: <value read> }`),
so a `power_restored` processed concurrently by the ingestion loop wins. Each
affected DT is then localized once, not once per pole.

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

**DT Rollup (Rule 5)**: If >= ROLLUP_THRESHOLD (90%) of *observable* poles under
a DT are CONFIRMED_DARK and no LIVE pole exists, emit a single DT_FAULT.
Unmonitored poles are excluded from numerator and denominator. So are poles
whose sensor runs legacy firmware (< 1.3) and is not yet dark: such sensors
send no `power_lost`, so for the first 32 minutes of an outage their "LIVE"
reading proves nothing. Once they time out they count as dark. Unknown
firmware is treated as modern (`isLegacyFirmware` in `packages/domain`).

**Feeder Rollup (Rule 6)**: Same logic across all DTs on a feeder. If >= 90%
of feeder-wide monitored poles are dark, emit a FEEDER_FAULT. DT-level
incidents for that feeder are superseded.

**Correlation window**: Both rollups require all dark events to fall within
CORRELATION_WINDOW_MS (5 minutes) to avoid rolling up unrelated sequential
faults.

### 6.4 RANGE Incident Expansion (range.js)

When a frontier edge has an unmonitored endpoint, `expandRangeIncident()`
walks the topology tree to bound the fault:

- `upstream_live_pole_id`: nearest monitored LIVE ancestor. When the frontier
  parent itself is unmonitored, the walk continues upward through unmonitored
  poles (adding them to the gap) until it reaches a monitored pole; that pole is
  the bound if LIVE, otherwise the bound is null.
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
5. Groups multiple SPAN incidents sharing the same `upstream_live_pole_id` into a single merged incident (lowest confidence wins; reasons are de-duplicated by code).
6. Returns `{ incidents, sensorSuspects }` — never writes to DB.

### 6.6 Incident Sync (incident-sync.js)

Idempotently persists localization output:

- Takes a transaction-scoped Postgres advisory lock first, so the ingestion
  loop and the sweeper can never create incidents for the same outage in
  parallel.
- For each computed incident, finds every active (non-VERIFIED, non-CLOSED)
  incident whose `affected_pole_ids` intersect it.
- One overlap: update it in place (type, confidence, poles; previous poles are
  kept in `historical_affected_pole_ids`).
- Several overlaps (for example SPAN and DT incidents that escalate into one
  FEEDER fault as the debounce completes pole by pole): keep one survivor, the
  incident whose ticket is furthest along the workflow, then the oldest. The
  others are absorbed into it and **deleted** with their tickets, so a single
  outage never leaves duplicate or half-finished tickets in history. The
  survivor keeps the earliest `first_detected_at`.
- No overlap: create a new incident and a new DETECTED ticket.
- Incidents with no computed counterpart are not auto-closed here; restoration
  is handled by the ticket workflow and the restoration verifier.

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

Generates a ~4,000-pole network (3,990 with the default seed) laid out the way
an urban distribution network is actually built:

- One 66/11 kV substation at the city centre. Five 11 kV feeders leave it
  radially along gently bending routes (at most 8 degrees per leg); each
  feeder's trunk is stored as `feeders.route`.
- 35 DTs, 7 per feeder, tapped onto the route: the first 900 m out, then one
  every 700 m.
- Each DT's LT network grows along a street lattice around it (38 m spans,
  a cross street every 3 spans, about 12% of street segments missing), so poles
  follow streets instead of scattering. Poles get up to 3 m of GPS jitter and
  are kept at least 20 m apart from other DTs' poles. About 114 poles per DT.
- About 9% of poles have no sensor; about 8% of sensors run legacy firmware.
- About 40% of DTs have `topology_source: RECORDED` (parent links on file);
  the other 60% are `MISSING` (parent_pole_id stripped in the registry export,
  wiring inferred by the MST, section 7).
- `sim_true_topology` stores the real parent/child for MISSING DTs, used only
  by the simulator for fault propagation. The localization engine never reads
  this table.

### Heartbeat Emitter (heartbeat-emitter.js)

Emits `heartbeat(energized=true)` via `POST /telemetry` for every healthy
device every **10 minutes** (HEARTBEAT_EMIT_INTERVAL_MS), legacy-firmware
devices included: they heartbeat normally while powered and only go silent
once they lose supply. Devices under an active SimulatorFault are skipped.
All emissions go through the real HTTP endpoint, never direct DB writes.

**Sequence numbers** come from `simulator/seq.js`: 100 ms ticks since
2025-01-01, forced strictly increasing within the process. One seq is used per
round or burst. (The previous `Date.now() % 2e9` wrapped every ~23 days, after
which every event was discarded by the seq rule.)

### Fault Injection (POST /api/simulator/inject)

Body: `{ type: 'SPAN' | 'DT' | 'FEEDER', target, duplicates?, reorder? }`.
SPAN takes a pole and cuts its subtree; DT takes all poles under a
transformer; FEEDER takes every pole on a feeder.

1. Insert the SimulatorFault row first, so a heartbeat round that runs
   mid-injection already skips the affected devices.
2. Post one `power_lost` per affected sensor running firmware >= 1.3 (all with
   one seq). Legacy sensors stay silent, as real ones do. Optional noise:
   duplicate resends and out-of-order delivery.
3. The ingestion worker marks those poles pending; after the 90 s debounce they
   are CONFIRMED_DARK and the fault is localized. Legacy sensors in the
   affected area follow later, via the 32-minute heartbeat timeout.

Repair (`POST /api/simulator/repair/:faultId`): sets `repaired_at` and posts
`power_restored` only for poles that are energized again, meaning poles not
still covered by another active fault. The ticket still needs an operator to
mark it repaired; the restoration verifier then confirms it from telemetry.

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

Technology: React (Vite), Tailwind, react-leaflet (canvas renderer),
lucide-react (icons). Served by nginx, which proxies `/api/*` to
`http://backend:3000`; `index.html` is never cached, hashed assets are cached
for a year.

### Layout

The Network map view is three panes side by side, so incidents and the map
never overlap:

| Pane | Component | Content |
|---|---|---|
| Left (320 px) | `IncidentList.jsx` | Active incidents with search, type/confidence filters, sort |
| Centre | `MapView.jsx` | The network, fault pins, layer control, collapsible legend |
| Right (380 px, on selection) | `IncidentDetail.jsx` or `AssetInspector.jsx` | The selected incident, pole, DT or feeder |

Below the `lg` breakpoint the panes become Incidents / Map / Details tabs.
Escape clears the selection. Incident history, the fault simulator,
scheduled outages and settings are opened from the sidebar: history replaces
the main area; the others open as panels over it.

`utils/networkModel.js` builds one index over the topology snapshot
(`buildNetworkIndex`), shared by map, inspector and incident views.

### Map

- **HT**: each feeder's `route` drawn as a trunk from the substation marker;
  it turns red while a FEEDER incident is active. Clicking it opens the feeder
  inspector (source, trunk length, DTs in order from the substation).
- **DTs**: square markers on the route, filled by the worst condition of
  their poles. Clicking one opens the DT inspector (pole counts by condition,
  capacity, wiring source).
- **LT**: every topology edge, coloured by the condition of the pole it feeds;
  inferred edges are dashed.
- **Poles**: all poles from zoom 15; below that, only poles without supply
  (so a fault is visible from the city-wide view). Clicking one opens the pole
  inspector (sensor, firmware, last reading, related incidents, including
  faults it is the live boundary of).

**Fault pinpoint** (`locateFault`):

| Type | Pin | Highlight |
|---|---|---|
| SPAN | Midpoint of the span from the live pole to the dark pole (at the live pole when several branches are dark) | The faulted span(s) |
| RANGE | Centroid of the unmonitored corridor | The corridor, dashed |
| DT | The transformer | None |
| FEEDER | The first leg out of the substation | The whole route in red |

A newly detected incident is opened and flown to automatically, unless the
operator is already looking at something, in which case a toast offers
"Locate". The toggle is in Settings.

### Live Update Strategy

Topology (`GET /api/map/topology`) is fetched once. Pole states
(`GET /api/map/state`) are polled every 5 s and incidents every 3 s, both
adjustable in Settings. There is no WebSocket; polling was chosen for
simplicity in the demo environment.

### Pole Colours on Map

| Colour | Condition |
|---|---|
| Green | LIVE |
| Amber | LIVE with `candidate_dark_since` set (losing power, inside the 90 s debounce) |
| Red | CONFIRMED_DARK |
| Violet | Covered by an active scheduled outage |
| Orange | SENSOR_SUSPECT |
| Slate | No recent data (STALE / OFFLINE_UNKNOWN / no state) |
| Hollow ring | No sensor on the pole |

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


