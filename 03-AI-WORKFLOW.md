# AI-WORKFLOW.md

## AI-Assisted Development Workflow

This project was developed with the assistance of multiple AI coding
agents. AI was used as an implementation accelerator for well-scoped
roadmap steps, test generation, debugging, documentation support, and
code review. However, AI-generated code was not treated as automatically
correct.

The development workflow followed a repeated cycle:

1.  Define a narrowly scoped implementation step with explicit goals,
    dependencies, validation criteria, and out-of-scope items.
2.  Delegate implementation to an AI coding agent.
3.  Review the agent's completion report and inspect high-risk
    architectural decisions.
4.  Validate behavior through unit tests, integration tests, runtime
    testing, database inspection, and end-to-end simulator flows.
5.  When an issue was found, diagnose the root cause before requesting a
    targeted correction.
6.  Add or strengthen regression tests so the same failure would be
    detected automatically in future changes.

Different agents were used across the project. This made independent
review useful, but it also demonstrated that changing models does not
remove the need for human verification: several implementations appeared
correct from unit-test results but exposed problems under concurrency,
persistence, asynchronous processing, or full runtime execution.

------------------------------------------------------------------------

## How AI Was Used

AI agents were primarily used for:

-   Implementing individual roadmap steps from explicit specifications.
-   Generating unit and integration tests from the assignment's test
    matrix.
-   Reviewing existing modules for contract mismatches and architectural
    boundary violations.
-   Diagnosing runtime failures using Docker logs, database state, API
    behavior, and test results.
-   Refactoring repeated numeric thresholds into centralized
    configuration.
-   Building frontend components against a documented backend API
    contract.
-   Drafting technical documentation from the final shipped
    implementation.

Important architectural decisions were reviewed rather than delegated
blindly. In particular, special attention was given to:

-   Separation between simulator ground truth and department-visible
    topology.
-   Idempotent telemetry processing.
-   Incident identity during re-localization.
-   Human `RESOLVED` versus telemetry-confirmed `VERIFIED` ticket
    states.
-   Confidence downgrades for inferred or ambiguous topology.
-   Crash recovery and transaction boundaries.
-   Runtime behavior of background workers.

------------------------------------------------------------------------

## Representative AI Mistakes and Corrections

The following examples are genuine failures or incomplete assumptions
encountered during AI-assisted development. They are included because
they influenced the final verification workflow.

### 1. Concurrent Topology Rebuilds Produced Duplicate Edges

**Task/Step:** Step 8 topology generation and later Docker/runtime
validation.

**Initial AI implementation/assumption:**\
The implementation assumed that rebuilding or restarting the backend and
worker containers was safe even though both services could execute
topology-building logic during startup.

**Why this was incorrect:**\
The backend and worker could rebuild topology concurrently. This could
create duplicate `topology_edges`. Duplicate parent-child relationships
then increased frontier traversal work and interfered with normal
incident detection.

**How it was discovered:**\
Runtime integration debugging. Simulator faults were visible in the
simulator interface, but expected incidents were not appearing in the
operator frontend.

**Correction:**\
A PostgreSQL advisory transaction lock was added around topology rebuild
so concurrent services could not rebuild the same topology
simultaneously. Edge handling was also made defensive by deduplicating
parent-child relationships during traversal/insertion.

**Repository evidence:** -
`apps/backend/src/scripts/build-topology.js` -
`apps/backend/src/localization/frontier.js`

**Workflow lesson:**\
Passing unit tests is insufficient for code executed concurrently by
multiple services. AI-generated startup and persistence logic must also
be validated under the actual multi-container runtime.

------------------------------------------------------------------------

### 2. Healthy Heartbeats Could Incorrectly Produce Dark Poles

**Task/Step:** Simulator telemetry realism and the ingestion-worker
pipeline.

**Initial AI implementation/assumption:**\
The worker was allowed to evaluate heartbeat timeout using the device's
previously stored `last_seen` value before the incoming healthy
heartbeat had refreshed device freshness.

**Why this was incorrect:**\
A valid `heartbeat(energized=true)` event arriving from a device whose
old `last_seen` was stale could be interpreted using the stale timestamp
first. This could incorrectly transition the pole toward
`CONFIRMED_DARK` and create incidents even though no physical fault had
been injected.

**How it was discovered:**\
Live Docker testing showed active incidents increasing without a
simulator fault being injected.

**Correction:**\
The ingestion path was changed so timeout evaluation uses the current
event's `server_received_at` as the relevant freshness timestamp.
Regression tests were added/updated, and the Docker startup heartbeat
behavior was adjusted to avoid an immediate artificial heartbeat burst.

**Repository evidence:** -
`apps/backend/src/worker/ingestion-worker.js` -
`apps/backend/src/worker/run.js` -
`apps/backend/src/simulator/heartbeat-emitter.js` -
`apps/backend/src/worker/ingestion-worker.integration.test.js` -
`apps/backend/src/simulator/ground-truth.integration.test.js` -
`docker-compose.yml`

**Workflow lesson:**\
For asynchronous event-processing systems, AI-generated logic must be
reviewed for event ordering and temporal assumptions, not only
final-state assertions.

------------------------------------------------------------------------

### 3. Database Reset Was Assumed to Guarantee Prisma Schema Synchronization

**Task/Step:** Development database reset while diagnosing old incidents
and ticket accumulation.

**Initial AI implementation/assumption:**\
A Docker volume reset using `docker compose down -v` followed by a
rebuild/start was assumed to guarantee that Prisma migrations and
seeding would reconstruct the database correctly.

**Why this was incomplete:**\
After the reset, Prisma reported no pending migrations while the runtime
database was missing required tables, including `sim_true_topology`. The
infrastructure command had completed, but the required application-level
end state had not actually been verified.

**How it was discovered:**\
Runtime API testing after reset. A simulator SPAN injection failed with
a Prisma error reporting that `public.sim_true_topology` did not exist.

**Correction:**\
The database state was explicitly synchronized using Prisma schema
tooling, the seed process was run again with the project's reseed
mechanism, and the worker was restarted so its runtime state matched the
rebuilt database.

**Repository/runtime evidence:** - Prisma error for missing
`public.sim_true_topology` - Database/schema synchronization command -
`seed.js` - Docker runtime validation

**Workflow lesson:**\
AI agents should verify the actual database end state after destructive
infrastructure operations instead of assuming that successful Docker
commands imply successful schema initialization.

------------------------------------------------------------------------

### 4. Background Worker Verification Relied on Logs That Did Not Exist

**Task/Step:** Runtime verification of debounce/sweeper behavior.

**Initial AI implementation/assumption:**\
Worker container logs were used as the expected source of evidence that
the background sweeper had executed after the debounce interval.

**Why this was incomplete:**\
The sweeper performed its work silently and did not emit the assumed
diagnostic log messages. Absence of log output therefore did not mean
the background process had failed.

**How it was discovered:**\
Code review of `apps/backend/src/worker/sweeper.js` after the expected
messages did not appear.

**Correction:**\
Verification switched from container stdout to direct database-state
inspection. Pole-state records were queried to determine whether the
expected state transition had actually occurred.

**Repository evidence:** - `apps/backend/src/worker/sweeper.js` -
Runtime queries against `pole_states` and `incidents`

**Workflow lesson:**\
Observability assumptions must themselves be verified. Runtime
correctness should be checked against authoritative state when logs are
not explicitly implemented.

------------------------------------------------------------------------

### 5. Missing Pole State Was Incorrectly Treated as LIVE

**Task/Step:** Step 19 localization orchestration.

**Initial AI implementation/assumption:**\
The localization orchestrator defaulted a pole with no `PoleState`
record to `LIVE`.

**Why this was incorrect:**\
A missing state is not evidence of power. This was especially damaging
for unmonitored poles. A `CONFIRMED_DARK` pole with an unmonitored
descendant could appear to have a fabricated LIVE descendant, causing
valid fault evidence to be misclassified as `SENSOR_SUSPECT`.

**How it was discovered:**\
Architecture/code review of the bridge between persisted pole state and
the pure localization engine.

**Correction:**\
The fabricated LIVE fallback was removed. Missing/unmonitored poles
remain undefined and are handled by the localization engine's
missing-device/RANGE rules.

**Repository evidence:** -
`apps/backend/src/localization/orchestrator.js` - Localization/RANGE
regression tests

**Workflow lesson:**\
AI often fills missing data with convenient defaults. In fault-detection
systems, absence of evidence must not silently become positive evidence.

------------------------------------------------------------------------

### 6. Re-localization Was Incorrectly Confused With Physical Repair

**Task/Step:** Step 19 incident synchronization/idempotency.

**Initial AI implementation/assumption:**\
When a fault boundary expanded upstream, the synchronization logic
created a new incident and marked the previous ticket `RESOLVED`.

**Why this was incorrect:**\
`RESOLVED` represents a field-repair lifecycle event. A localization
algorithm changing its estimate does not mean a crew repaired anything.
This incorrectly mixed algorithmic supersession with operational ticket
state.

**How it was discovered:**\
Review of the idempotency implementation and ticket semantics.

**Correction:**\
Incident synchronization was rewritten to preserve incident/ticket
identity when the affected region changes. Existing active incidents are
updated in place when appropriate instead of being falsely resolved and
replaced.

**Repository evidence:** -
`apps/backend/src/localization/incident-sync.js` - Ingestion/idempotency
integration tests

**Workflow lesson:**\
AI-generated persistence logic must be checked against domain semantics,
not merely whether it produces a technically valid database state.

------------------------------------------------------------------------

### 7. Simulator Initially Lacked Hidden Physical Topology for MISSING DTs

**Task/Step:** Step 23 simulator ground-truth module.

**Initial AI implementation/assumption:**\
The simulator used the same department-visible `Pole.parent_pole_id`
data that production code used. For DTs whose topology was intentionally
missing, those parent relationships had already been stripped.

**Why this was incorrect:**\
A utility department not knowing a topology does not mean the physical
network has no topology. The simulator must know physical truth so it
can generate realistic outages while the production localization engine
is forced to infer that topology independently.

**How it was discovered:**\
Architectural review of the simulator/production boundary.

**Correction:**\
A simulator-only `sim_true_topology` representation was introduced and
populated before registry export removes hidden topology. Simulator SPAN
traversal uses this private physical topology, while production
localization remains isolated from it. A boundary test later enforced
that isolation.

**Repository evidence:** - Simulator ground-truth implementation -
`sim_true_topology` -
`apps/backend/src/__tests__/ground-truth-isolation.test.js` -
Missing-topology simulator integration test

**Workflow lesson:**\
When AI works across simulation and production code, explicit trust
boundaries are essential; otherwise test infrastructure can accidentally
leak the expected answer into the algorithm being evaluated.

------------------------------------------------------------------------

### 8. RANGE Incidents Passed Logic Tests but Failed the Persistence Contract

**Task/Step:** Step 16 RANGE handling, discovered during later
end-to-end runtime testing.

**Initial AI implementation/assumption:**\
`expandRangeIncident()` correctly calculated RANGE boundaries but did
not include the required `affected_pole_ids` field expected by the
Incident persistence contract.

**Why this was incorrect:**\
When the ingestion worker attempted to persist the RANGE incident,
Prisma rejected `incident.create()` because `affected_pole_ids` was
missing. Because processing occurred inside an atomic transaction, the
inbox row rolled back and remained pending. The worker immediately
retried the same row, creating a poison-pill loop that eventually left
2,944 telemetry events pending.

**How it was discovered:**\
End-to-end runtime diagnosis after new simulator faults stopped
producing incidents. Database inspection revealed the large unprocessed
telemetry backlog, and worker tracing identified the Prisma validation
failure.

**Correction:**\
RANGE expansion was updated to construct `affected_pole_ids` using the
unmonitored gap, downstream dark boundaries, and their affected
descendants. An integration regression test passes a RANGE incident
through the same `syncIncidents()` persistence path used by the worker.

After restart, the pending telemetry count began falling and
processed-event count increased, confirming that the runtime pipeline
had recovered.

**Repository evidence:** - `apps/backend/src/localization/range.js` -
`apps/backend/src/localization/incident-sync.integration.test.js` -
`apps/backend/src/localization/incident-sync.js` - Runtime
`telemetry_inbox` inspection

**Workflow lesson:**\
A pure-function unit test can validate algorithmic output while still
missing a downstream persistence contract. AI-generated modules should
be tested across their real integration boundary.

------------------------------------------------------------------------

### 9. Restoration Verification Was Implemented but Never Started

**Task/Step:** Step 22 restoration verifier, discovered during
frontend/end-to-end testing.

**Initial AI implementation/assumption:**\
`runRestorationVerifier()` was implemented and integration-tested, which
gave the appearance that restoration verification was complete.

**Why this was incomplete:**\
The function was not connected to the active backend/worker lifecycle.
Therefore a ticket could enter `RESOLVED`, restoration telemetry could
return poles to LIVE, and the ticket would still remain indefinitely at
`RESOLVED` because no runtime process was actually executing the
verifier.

**How it was discovered:**\
End-to-end UI testing showed tickets permanently displaying "Waiting for
telemetry confirmation...". Repository-wide inspection showed the
verifier was referenced by tests but not scheduled by the running
worker.

**Correction:**\
The verifier needed to be wired into the existing background-worker
lifecycle so RESOLVED tickets are periodically checked and
system-transitioned to `VERIFIED` when monitored affected poles are
LIVE.

**Repository evidence:** -
`apps/backend/src/tickets/restoration-verifier.js` -
Restoration-verifier integration tests - Worker runtime/startup modules

**Workflow lesson:**\
An implemented and tested background function is not a completed feature
until runtime startup and scheduling are also verified.

------------------------------------------------------------------------

## Verification Strategy for AI-Generated Work

The project gradually adopted multiple layers of verification because
different classes of AI mistakes escaped different test levels.

### Unit tests

Used for deterministic pure logic such as:

-   Pole-state transitions.
-   Frontier detection.
-   DT/feeder rollup.
-   RANGE expansion.
-   Confidence categorization.
-   Topology inference invariants.

### Integration tests

Used when correctness depended on contracts between modules:

-   Telemetry inbox → worker → PoleState.
-   Localization → incident persistence.
-   Crash recovery and idempotency.
-   Simulator → `/telemetry` → localization.
-   Restoration verification.
-   Scheduled-outage overlap.
-   API response contracts.

### Static boundary tests

A dedicated ground-truth isolation test scans production
topology/localization code and fails if simulator-only ground-truth
references are introduced.

This was added because ground-truth leakage could make localization
results look artificially accurate while invalidating the architecture.

### Runtime validation

Docker-based end-to-end testing exposed several problems that
unit/integration tests did not initially reveal, including:

-   Concurrent topology rebuild behavior.
-   Unexpected heartbeat-generated incidents.
-   Persistent development data.
-   Poison telemetry backlog.
-   Background functions that existed but were never scheduled.

### Database inspection

For asynchronous workflows, database state was treated as authoritative
evidence when logs or UI state were insufficient. This included
inspecting:

-   `telemetry_inbox`
-   `pole_states`
-   incidents
-   tickets
-   simulator faults
-   topology records

------------------------------------------------------------------------

## Human Review and Responsibility

AI agents were allowed to generate and modify substantial portions of
the implementation, but final architectural responsibility remained with
the developer.

Human review focused particularly on questions such as:

-   Is an inferred topology being represented as inferred rather than
    fact?
-   Could simulator ground truth leak into production localization?
-   Does a ticket state represent the correct real-world meaning?
-   Does missing telemetry mean UNKNOWN rather than LIVE?
-   Can retries create duplicate incidents?
-   Can one malformed event stop the worker?
-   Does a background feature actually run in production, not only in
    tests?
-   Are documentation claims verifiable against the repository?

When an AI completion report claimed that a step was finished, the claim
was treated as a hypothesis to validate rather than proof of
correctness.

------------------------------------------------------------------------

## Multi-Agent Workflow

Multiple AI models/agents were used depending on task complexity.

Straightforward, well-specified tasks such as test scaffolding, route
consolidation, and limited simulator controls were delegated to faster
coding agents. More architecture-sensitive work such as localization
rules, persistence/idempotency, simulator boundaries, and system
documentation received stronger-model or additional human review.

Using multiple agents also provided a useful form of independent review.
An implementation produced by one agent could be inspected by another
agent or manually tested without relying on the original agent's
assumptions.

However, multi-agent use introduced its own risk: a new agent does not
automatically share every architectural assumption made earlier. For
that reason, later tasks were supplied with explicit scope constraints,
source-of-truth documents, dependencies, and "do not change" lists.

------------------------------------------------------------------------

## Scope Control

A recurring practice was to explicitly constrain agents from
over-engineering roadmap steps.

For example, simulator noise injection intentionally implemented only:

-   Duplicate resends.
-   Out-of-order delivery.
-   Firmware-1.2.x silence.
-   Missing dying messages.

Long-tail stale retry and device-silent-while-powered scenarios remained
test fixtures rather than becoming unnecessary simulator UI controls.

Similarly, frontend agents were instructed to use the documented API
contract rather than invent new backend fields or endpoints.

This reduced agent-driven scope creep and kept implementation aligned
with the assignment.

------------------------------------------------------------------------

## Key Takeaways

The project demonstrated that AI coding agents are highly effective for
accelerating implementation when tasks are well specified, but their
output still requires engineering verification.

The most important lessons were:

-   Green unit tests do not prove runtime correctness.
-   Persistence contracts need integration tests.
-   Concurrent startup logic needs real multi-service testing.
-   Missing data must not be replaced with convenient assumptions.
-   Domain semantics must be reviewed separately from code correctness.
-   Simulator/test ground truth requires hard isolation boundaries.
-   Background jobs must be proven to run in the deployed lifecycle.
-   Runtime/database evidence is often more reliable than an AI
    completion report.
-   Every significant AI-discovered bug should result in a regression
    test where practical.

The final workflow therefore treated AI as an implementation and
analysis partner, while tests, runtime evidence, architectural
boundaries, and human review remained the basis for accepting changes.
