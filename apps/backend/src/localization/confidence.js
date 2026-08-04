/**
 * @file confidence.js
 *
 * Localization Engine — Confidence Rules Engine (Section I)
 *
 * This module is PURE: no DB access, no side effects. All thresholds are
 * imported from @kspdb/domain/thresholds — no inline numeric literals.
 *
 * Categorical HIGH / MEDIUM / LOW, via explicit rule precedence — never a
 * numeric percentage. The reasons list returned is the literal set of triggered
 * conditions — directly traceable to code, zero LLM involvement.
 *
 * --- Section I Rules (verbatim from master plan) ---
 *
 * HIGH if: all edges AUTHORITATIVE, frontier touches two monitored devices,
 *   no missing-device gap, no stale/borderline telemetry, no scheduled-outage
 *   overlap.
 *
 * Downgrade to MEDIUM if any of:
 *   - Topology INFERRED (non-ambiguous)
 *   - Missing-device gap present (RANGE incident type)
 *   - Evidence relies on heartbeat-timeout rather than explicit power_lost
 *   - Scheduled-outage overlap flagged
 *
 * Downgrade to LOW if any of:
 *   - Topology INFERRED + ambiguous
 *   - RANGE spans more than RANGE_LOW_CONFIDENCE_POLE_CUTOFF poles
 *   - Evidence relies solely on 1.2.x heartbeat-timeout with no corroborating device
 *   - Conflicting evidence within the subtree (SENSOR_SUSPECT present)
 *
 * --- Note on precedence ---
 * LOW conditions are checked first. If any LOW condition fires, the result is LOW
 * regardless of MEDIUM triggers. MEDIUM is checked second. If none fire, HIGH.
 * This means a single ambiguous INFERRED edge forces LOW — MEDIUM is not a
 * halfway house when LOW criteria are met.
 */

import { RANGE_LOW_CONFIDENCE_POLE_CUTOFF } from '../../../../packages/domain/src/thresholds.js';

/**
 * @typedef {'HIGH' | 'MEDIUM' | 'LOW'} ConfidenceLevel
 */

/**
 * Input evidence structure for the confidence engine.
 *
 * @typedef {Object} ConfidenceEvidence
 * @property {'SPAN'|'DT'|'FEEDER'|'RANGE'} incident_type          Incident classification
 * @property {'AUTHORITATIVE'|'INFERRED'}   topology_source         Dominant topology source
 * @property {boolean}                       ambiguous_edge          Any edge in the path is ambiguous
 * @property {boolean}                       has_range               True if RANGE incident type
 * @property {number}                        range_pole_count        Number of poles in RANGE gap (0 if not RANGE)
 * @property {boolean}                       has_unmonitored_gap     True if any boundary pole is unmonitored
 * @property {boolean}                       evidence_heartbeat_only True if CONFIRMED_DARK came ONLY from timeout, not power_lost
 * @property {boolean}                       evidence_fw12_only      True if heartbeat-timeout ONLY from fw<1.3 devices (weakest signal)
 * @property {boolean}                       has_sensor_suspect      True if any SENSOR_SUSPECT pole is in the affected subtree
 * @property {boolean}                       scheduled_outage_overlap True if overlap with scheduled maintenance window
 */

/**
 * A reason code + human-readable message pair emitted by the confidence engine.
 *
 * @typedef {Object} ConfidenceReason
 * @property {string} code    Machine-readable reason key (for programmatic use / UI badge)
 * @property {string} detail  Human-readable explanation (shown in the incident detail panel)
 */

/**
 * @typedef {Object} ConfidenceResult
 * @property {ConfidenceLevel}    level    The final categorical confidence level
 * @property {ConfidenceReason[]} reasons  Non-empty list of triggered reason codes
 */

/**
 * Evaluates the confidence level for a given incident's evidence.
 *
 * All threshold comparisons read from thresholds.js. No inline numeric literals.
 *
 * @param {ConfidenceEvidence} evidence
 * @returns {ConfidenceResult}
 */
export function evaluateConfidence(evidence) {
  /** @type {ConfidenceReason[]} */
  const reasons = [];

  // ─── Section I: LOW conditions (checked first — any LOW trigger beats MEDIUM) ──

  if (evidence.topology_source === 'INFERRED' && evidence.ambiguous_edge) {
    reasons.push({
      code: 'INFERRED_AMBIGUOUS',
      detail: 'Topology is estimated and an alternative route within distance tolerance exists — fault location is uncertain.',
    });
  }

  if (evidence.has_range && evidence.range_pole_count > RANGE_LOW_CONFIDENCE_POLE_CUTOFF) {
    reasons.push({
      code: 'RANGE_TOO_LARGE',
      detail: `Fault bounded within a gap of ${evidence.range_pole_count} poles — too wide to dispatch crew to a specific location.`,
    });
  }

  if (evidence.evidence_fw12_only) {
    reasons.push({
      code: 'FW12_TIMEOUT_ONLY',
      detail: 'Fault inferred solely from silence of fw<1.3 devices — no power_lost event received, no corroborating device report.',
    });
  }

  if (evidence.has_sensor_suspect) {
    reasons.push({
      code: 'SENSOR_SUSPECT_PRESENT',
      detail: 'A CONFIRMED_DARK pole with a LIVE descendant was detected — conflicting evidence within the subtree, sensor malfunction possible.',
    });
  }

  if (reasons.length > 0) {
    return { level: 'LOW', reasons };
  }

  // ─── Section I: MEDIUM conditions ────────────────────────────────────────────

  if (evidence.topology_source === 'INFERRED') {
    reasons.push({
      code: 'INFERRED_TOPOLOGY',
      detail: 'Topology is estimated from GPS layout (MST heuristic) — real electrical path may differ.',
    });
  }

  if (evidence.has_range || evidence.has_unmonitored_gap) {
    reasons.push({
      code: 'MISSING_DEVICE_GAP',
      detail: 'One or more poles in the fault boundary have no monitoring device — exact fault edge cannot be determined.',
    });
  }

  if (evidence.evidence_heartbeat_only) {
    reasons.push({
      code: 'HEARTBEAT_TIMEOUT_EVIDENCE',
      detail: 'CONFIRMED_DARK status derived from missed heartbeats rather than an explicit power_lost event — less direct evidence.',
    });
  }

  if (evidence.scheduled_outage_overlap) {
    reasons.push({
      code: 'SCHEDULED_OUTAGE_OVERLAP',
      detail: 'A scheduled maintenance window overlaps this incident — fault may be intentional.',
    });
  }

  if (reasons.length > 0) {
    return { level: 'MEDIUM', reasons };
  }

  // ─── Section I: HIGH (no downgrade conditions met) ────────────────────────────

  reasons.push({
    code: 'HIGH_CONFIDENCE',
    detail: 'Authoritative topology, directly monitored boundary poles, no device gap, no stale telemetry, no scheduled overlap.',
  });

  return { level: 'HIGH', reasons };
}

/**
 * Derives the ConfidenceEvidence object from a frontier edge and associated
 * incident context. This is the bridge between raw detectFrontier() output and
 * the pure evaluateConfidence() function.
 *
 * @param {object}   frontierEdge          A single FrontierEdge from detectFrontier()
 * @param {object}   [rangeIncident]       The corresponding RangeIncident, if any
 * @param {string[]} [sensorSuspects]      List of SENSOR_SUSPECT pole IDs from detectFrontier()
 * @param {boolean}  [scheduledOutage]     True if a scheduled outage overlaps this incident
 * @param {Map<string, {status: string, evidence_type: string}>} [poleStates]
 * @param {string[]} [affectedPoleIds]     List of all affected pole IDs in the subtree
 * @returns {ConfidenceEvidence}
 */
export function buildConfidenceEvidence(
  frontierEdge,
  rangeIncident = null,
  sensorSuspects = [],
  scheduledOutage = false,
  poleStates = new Map(),
  affectedPoleIds = []
) {
  const incidentType = rangeIncident ? 'RANGE' : 'SPAN';
  const isRange = incidentType === 'RANGE';
  const rangePoleCount = rangeIncident ? rangeIncident.gap_pole_count : 0;

  let isHeartbeatOnly = false;
  let isFw12Only = false;

  const polesToCheck = affectedPoleIds.length > 0 ? affectedPoleIds : [frontierEdge.child_pole_id];
  let hasMonitored = false;
  let allTimeouts = true;
  let allFw12 = true;

  for (const pid of polesToCheck) {
    const state = poleStates.get(pid);
    if (state && state.evidence_type) {
      hasMonitored = true;
      if (state.evidence_type !== 'timeout_fw13' && state.evidence_type !== 'timeout_fw12') {
        allTimeouts = false;
      }
      if (state.evidence_type !== 'timeout_fw12') {
        allFw12 = false;
      }
    }
  }

  if (hasMonitored) {
    isHeartbeatOnly = allTimeouts;
    isFw12Only = allFw12;
  }

  return {
    incident_type: incidentType,
    topology_source: frontierEdge.source,
    ambiguous_edge: frontierEdge.ambiguous === true,
    has_range: isRange,
    range_pole_count: rangePoleCount,
    has_unmonitored_gap: isRange,
    evidence_heartbeat_only: isHeartbeatOnly,
    evidence_fw12_only: isFw12Only,
    has_sensor_suspect: sensorSuspects.length > 0,
    scheduled_outage_overlap: scheduledOutage === true,
  };
}
