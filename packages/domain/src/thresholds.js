/**
 * @file thresholds.js
 *
 * The single, authoritative source for every tunable numeric constant in the
 * KSPDB Fault-Localization engine.
 *
 * WHY ONE FILE:
 *   Every "why is this value X and not Y?" question in the demo interview must
 *   be answerable by pointing at this file. If a constant is scattered inline
 *   across 5 modules, the answer is "no idea". If it lives here with a one-line
 *   justification, the answer is clear and the constant is trivially tunable
 *   without hunting through logic code.
 *
 * USAGE:
 *   import { DEBOUNCE_MS, ROLLUP_THRESHOLD, ... } from '@kspdb/domain/thresholds';
 *   // OR directly:
 *   import { DEBOUNCE_MS } from '../../../packages/domain/src/thresholds.js';
 *
 * CHANGE DISCIPLINE:
 *   Only change these values with explicit, documented justification.
 *   The Step 25 boundary test runs a grep to assert no bare numeric literals
 *   representing domain thresholds appear outside this file.
 */

// ─── Pole-State Derivation ────────────────────────────────────────────────────

/**
 * ~90 seconds debounce before a candidate-dark transition is confirmed.
 * Rationale: covers NTP clock skew between device and server, plus typical
 * 5–30 s LTE transmission lag for power_lost events. Short enough that a real
 * outage is confirmed quickly; long enough to filter transient noise.
 *
 * Source: Section H, Rule 6 + Section C ("~90s skew tolerance").
 */
export const DEBOUNCE_MS = 90_000;

/**
 * ~32 minutes before a silent device is declared CONFIRMED_DARK via heartbeat timeout.
 * Rationale: devices heartbeat every 15 min. Two missed heartbeats = 30 min.
 * +2 min buffer for delivery jitter and processing lag before declaring dark.
 * Any longer risks missing a real outage; any shorter risks false positives on
 * poor-coverage areas.
 *
 * Source: Section H, Rule 4 + Section C ("~32 min").
 */
export const HEARTBEAT_TIMEOUT_MS = 32 * 60 * 1_000;

/**
 * Firmware version boundary below which fw-1.2.x timeout-only inference applies.
 * Devices with fw < FW_LEGACY_THRESHOLD never send power_lost — their only signal
 * is silence (heartbeat timeout).
 *
 * Source: Section C, Section H Rule 4.
 */
export const FW_LEGACY_THRESHOLD = '1.3';

// ─── DT / Feeder Rollup ───────────────────────────────────────────────────────

/**
 * Fraction of *monitored* poles under a DT (or across a feeder) that must be
 * CONFIRMED_DARK to trigger a DT_FAULT or FEEDER_FAULT rollup.
 * Rationale: 90% leaves room for the ~9% no-device gap and late-arriving events
 * without requiring perfection. At 80% too many partial-outages would roll up
 * incorrectly; at 95% a legitimate full-DT fault could be missed when 2 devices
 * fail to report.
 *
 * Source: Section C ("≥90% of monitored poles"), Section H Rule 5.
 */
export const ROLLUP_THRESHOLD = 0.90;

/**
 * "Roughly simultaneous" for DT/feeder rollup = within this window.
 * Rationale: 5 minutes captures an event wave crossing a radial DT (typical
 * cascade time ~30 s) plus the 90 s debounce per pole, with comfortable margin.
 * A 10-min window would risk rolling up unrelated sequential faults.
 *
 * Source: Section C ("5-minute correlation window").
 */
export const CORRELATION_WINDOW_MS = 5 * 60 * 1_000;

// ─── Topology Inference (MST heuristic) ──────────────────────────────────────

/**
 * Maximum number of children a single pole may have in the inferred MST.
 * Rationale: real LT distribution lines typically branch 1–5 times; capping at
 * 4 avoids producing implausible star topologies from the pure distance MST,
 * while allowing the degree-capped Dijkstra fallback to take over.
 *
 * Source: Section G ("branch 1–5 times").
 */
export const MST_MAX_DEGREE = 4;

/**
 * An inferred edge is flagged `ambiguous=true` when an alternative candidate
 * parent is within this fraction of the chosen edge's haversine weight.
 * Rationale: 15% gap is wide enough to flag genuinely uncertain junctions
 * (parallel roads, cul-de-sacs) without flagging every edge in a clean line.
 *
 * Source: Section G ("within ~15% of a chosen edge's weight"), Section C
 * ("15% ambiguity tolerance").
 */
export const MST_AMBIGUITY_TOLERANCE = 0.15;

// ─── RANGE Incident Classification ───────────────────────────────────────────

/**
 * Maximum number of poles in a RANGE incident before confidence drops to LOW.
 * Rationale: a RANGE spanning > 10 unmonitored poles is too large to dispatch
 * crew meaningfully — the fault location is essentially unknown. Below this
 * threshold, the bounded range is still actionable (crew can walk the segment).
 *
 * Source: Section I ("RANGE spans more than N poles → LOW"), value chosen to
 * match a crew's practical patrol range in a densely-wired ward.
 */
export const RANGE_LOW_CONFIDENCE_POLE_CUTOFF = 10;

// ─── Scheduled Outage Overlap ─────────────────────────────────────────────────

/**
 * Buffer applied to the end of a scheduled outage window when checking overlap.
 * Rationale: outage-end times are unreliable (~10% cancelled without update,
 * crews often run 30–40 min over). This buffer prevents the scheduled-overlap
 * flag from vanishing the moment a planned window officially closes, keeping
 * the operator aware that overrun is likely.
 *
 * Source: Section C ("±~40 min overrun buffer"), Section J fault handling.
 */
export const SCHEDULED_OUTAGE_OVERRUN_BUFFER_MS = 40 * 60 * 1_000;

// ─── AI Explainer ─────────────────────────────────────────────────────────────

/**
 * Budget for the AI explainer API call before the deterministic fallback template
 * is used instead.
 * Rationale: 3 seconds is near the operator's perceived-instant threshold. A
 * blocked AI call must never delay the incident display — the fallback renders
 * the same layout, just without the "AI-enhanced" badge.
 *
 * Source: Section C ("~3s"), Section L ("Failure fallback").
 */
export const AI_EXPLAINER_TIMEOUT_MS = 3_000;
