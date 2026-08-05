# Architectural Decisions (DECISIONS.md)

This document records the key architectural decisions made during the design and implementation of the KSPDB Fault Localization Engine. Each decision captures the context, the approach taken, and the consequences (both positive and negative).

---

## 1. Asynchronous Ingestion via PostgreSQL Queue

**Context**: The system must handle sustained ingestion of 500 telemetry messages per second and bursts of 5,000 messages in 10 seconds.
**Decision**: We decoupled HTTP ingestion from business logic. The Fastify API validates payloads and inserts them into a `telemetry_inbox` table with `PENDING` status, returning `202 Accepted`. A separate background worker uses `SELECT ... FOR UPDATE SKIP LOCKED` to process the queue.
**Consequences**:
- **Positive**: Extremely fast HTTP response times. The API comfortably handles >900 RPS (measured in Step 33). We avoid deploying external brokers like Redis or RabbitMQ, keeping the operational footprint minimal.
- **Negative**: Adds latency between a message arriving and an incident appearing. At very high loads with a single worker, the queue backlog could grow.

## 2. Handling Legacy Firmware (Heartbeat Timeouts)

**Context**: Devices with firmware < 1.3 do not emit `power_lost` events. The system must still detect faults on these lines.
**Decision**: We rely on the absence of heartbeats. The worker's sweeper checks `device.last_seen`. If a device is silent for > `HEARTBEAT_TIMEOUT_MS` (32 minutes), it is marked `CONFIRMED_DARK` with a `timeout_fw12` evidence type.
**Consequences**:
- **Positive**: 100% backward compatibility with older devices.
- **Negative**: Fault detection for these segments is inherently delayed by 32 minutes. The confidence engine marks these as `LOW` confidence because silence is not definitive proof of a fault (it could be a network jam).

## 3. Pure Functional Localization Engine

**Context**: Fault boundary detection (frontier logic), rollups, and range expansion are complex, graph-based algorithms. Tying them to database queries makes them hard to test and prone to race conditions.
**Decision**: The entire `apps/backend/src/localization/` directory (except the orchestrator) is implemented as pure functions. They accept in-memory arrays/maps (edges, pole states) and return computed incidents without any side effects or DB calls.
**Consequences**:
- **Positive**: High testability. We can easily unit test the core engine with mock arrays. It prevents deadlocks since the DB is only queried at the start and updated at the end by the orchestrator.
- **Negative**: The orchestrator must fetch the entire DT's topology into memory before running the logic. For LT networks (~30 poles per DT), this is cheap, but it would not scale to loading an entire state's transmission grid into memory.

## 4. Minimum Spanning Tree (MST) for Missing Topology

**Context**: ~30% of transformers have unrecorded ("MISSING") topology. The localization engine requires a tree structure to perform top-down boundary searches.
**Decision**: We use a degree-constrained Minimum Spanning Tree (MST) based on Haversine GPS distances to infer the parent-child relationships for these DTs. We flag edges where an alternative parent is within 15% distance as `ambiguous`.
**Consequences**:
- **Positive**: The engine can seamlessly localize faults even in unmapped areas.
- **Negative**: Real electrical lines follow roads, not straight lines. Inferences can be wrong. The confidence engine strictly downgrades any incident relying on inferred topology to `MEDIUM` or `LOW` confidence to warn operators.

## 5. Non-Destructive Incident Idempotency

**Context**: A fault can evolve. A single wire snapping (`SPAN` fault) might eventually cause the whole transformer to trip (`DT` fault).
**Decision**: `incident-sync.js` computes new incidents and checks for overlapping `affected_pole_ids` with active tickets. If it finds an overlap, it merges the new scope into the existing incident rather than opening a duplicate ticket.
**Consequences**:
- **Positive**: Operators aren't spammed with multiple tickets as a fault cascades upstream or downstream. The history of affected poles is preserved.
- **Negative**: Edge cases involving two separate, simultaneous faults on adjacent branches could theoretically be merged into one ticket.

## 6. Scheduled Outages Lower Confidence, Not Visibility

**Context**: When crews perform scheduled maintenance, poles legitimately go dark.
**Decision**: Overlapping scheduled outages do *not* suppress incident generation or ticket creation. Instead, the confidence engine assigns them `SCHEDULED_OUTAGE_OVERLAP` (which limits confidence to `MEDIUM`), and the UI highlights the ticket as overlapping with maintenance.
**Consequences**:
- **Positive**: Safety. If a real, unplanned fault happens simultaneously inside a maintenance zone, it is not silently dropped. 
- **Negative**: Operators must manually close or ignore tickets generated during routine maintenance.

## 7. Sweeper Double-Check Pattern

**Context**: The sweeper runs every 5 seconds, searching for poles that have exceeded their 90-second debounce or 32-minute timeout window.
**Decision**: The sweeper explicitly restricts its `UPDATE` queries using optimistic locking (e.g., verifying `candidate_dark_since` hasn't changed since the `SELECT`).
**Consequences**:
- **Positive**: Prevents race conditions where a `power_restored` event arrives nanoseconds before the sweeper transitions the pole to `CONFIRMED_DARK`.
- **Negative**: Slightly more verbose database logic in `sweeper.js`.

## 8. Simulator Isolation

**Context**: The system needs to prove it works on realistic data, but generating synthetic data shouldn't pollute the core business logic.
**Decision**: The `sim_true_topology` table and `SimulatorFault` tables are strictly isolated. The localization engine is unaware they exist. Ground truth faults simply suppress the heartbeat emitter and inject `power_lost` via the real HTTP `/telemetry` endpoint.
**Consequences**:
- **Positive**: The pipeline treats the simulator exactly like a real hardware deployment.
- **Negative**: The worker process bundles both the ingestion loop and the simulator heartbeat emitter, which uses slightly more CPU than a pure worker would in production.
