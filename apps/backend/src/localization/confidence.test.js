/**
 * @file confidence-section-i.test.js
 *
 * Step 17 — Confidence model unit tests.
 *
 * Derived directly from Section I of the master plan.
 * Tests assert SPECIFICATION behavior, not implementation-internal consistency.
 *
 * Specification reference (Section I):
 *   HIGH if: all edges AUTHORITATIVE, frontier touches two monitored devices,
 *     no missing-device gap, no stale telemetry, no scheduled-outage overlap.
 *   MEDIUM if any of: topology INFERRED (non-ambiguous), missing-device gap,
 *     heartbeat-timeout evidence, scheduled-outage overlap.
 *   LOW if any of: topology INFERRED + ambiguous, RANGE > N poles,
 *     fw<1.3 heartbeat-timeout ONLY with no corroboration, conflicting subtree.
 *   Precedence: LOW beats MEDIUM; MEDIUM beats HIGH.
 *   reasons list: always non-empty, codes from fixed enum.
 *
 * Known valid reason codes (from confidence.js):
 *   LOW:    INFERRED_AMBIGUOUS, RANGE_TOO_LARGE, FW12_TIMEOUT_ONLY, SENSOR_SUSPECT_PRESENT
 *   MEDIUM: INFERRED_TOPOLOGY, MISSING_DEVICE_GAP, HEARTBEAT_TIMEOUT_EVIDENCE, SCHEDULED_OUTAGE_OVERLAP
 *   HIGH:   HIGH_CONFIDENCE
 */

import { describe, it, expect } from 'vitest';
import { evaluateConfidence, buildConfidenceEvidence } from './confidence.js';
import { RANGE_LOW_CONFIDENCE_POLE_CUTOFF } from '../../../../packages/domain/src/thresholds.js';

// ─── Fixed Reason Code Enum (authoritative list per confidence.js) ─────────────

const VALID_REASON_CODES = new Set([
  'INFERRED_AMBIGUOUS',
  'RANGE_TOO_LARGE',
  'FW12_TIMEOUT_ONLY',
  'SENSOR_SUSPECT_PRESENT',
  'INFERRED_TOPOLOGY',
  'MISSING_DEVICE_GAP',
  'HEARTBEAT_TIMEOUT_EVIDENCE',
  'SCHEDULED_OUTAGE_OVERLAP',
  'HIGH_CONFIDENCE',
]);

// ─── Helper: build a base clean-evidence object (yields HIGH) ────────────────

function baseEvidence(overrides = {}) {
  return {
    incident_type: 'SPAN',
    topology_source: 'AUTHORITATIVE',
    ambiguous_edge: false,
    has_range: false,
    range_pole_count: 0,
    has_unmonitored_gap: false,
    evidence_heartbeat_only: false,
    evidence_fw12_only: false,
    has_sensor_suspect: false,
    scheduled_outage_overlap: false,
    ...overrides,
  };
}

// ─── Invariant: reasons always non-empty and codes from the fixed enum ────────

describe('Confidence Engine invariants (Section I)', () => {

  const scenarios = [
    ['HIGH — clean',          baseEvidence()],
    ['MEDIUM — INFERRED',     baseEvidence({ topology_source: 'INFERRED' })],
    ['MEDIUM — heartbeat',    baseEvidence({ evidence_heartbeat_only: true })],
    ['LOW — ambiguous',       baseEvidence({ topology_source: 'INFERRED', ambiguous_edge: true })],
    ['LOW — fw12 only',       baseEvidence({ evidence_fw12_only: true, evidence_heartbeat_only: true })],
    ['LOW — sensor suspect',  baseEvidence({ has_sensor_suspect: true })],
  ];

  for (const [label, ev] of scenarios) {
    it(`reasons array is non-empty for "${label}"`, () => {
      const result = evaluateConfidence(ev);
      expect(result.reasons.length).toBeGreaterThan(0);
    });

    it(`all reason codes are from the fixed enum for "${label}"`, () => {
      const result = evaluateConfidence(ev);
      for (const reason of result.reasons) {
        expect(VALID_REASON_CODES.has(reason.code)).toBe(true);
        expect(typeof reason.detail).toBe('string');
        expect(reason.detail.length).toBeGreaterThan(0);
      }
    });
  }
});

// ─── HIGH confidence ──────────────────────────────────────────────────────────

describe('HIGH confidence (Section I — all conditions clean)', () => {

  it('returns HIGH when all evidence is authoritative, monitored, no gap, no stale, no overlap', () => {
    const result = evaluateConfidence(baseEvidence());
    expect(result.level).toBe('HIGH');
  });

  it('HIGH reason code is HIGH_CONFIDENCE', () => {
    const result = evaluateConfidence(baseEvidence());
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0].code).toBe('HIGH_CONFIDENCE');
  });

  it('HIGH is NOT triggered when INFERRED topology is present', () => {
    const result = evaluateConfidence(baseEvidence({ topology_source: 'INFERRED' }));
    expect(result.level).not.toBe('HIGH');
  });

  it('HIGH is NOT triggered when heartbeat-timeout evidence is present', () => {
    const result = evaluateConfidence(baseEvidence({ evidence_heartbeat_only: true }));
    expect(result.level).not.toBe('HIGH');
  });
});

// ─── MEDIUM confidence ────────────────────────────────────────────────────────

describe('MEDIUM confidence (Section I — single MEDIUM trigger, no LOW)', () => {

  it('INFERRED non-ambiguous topology → MEDIUM with reason INFERRED_TOPOLOGY', () => {
    const result = evaluateConfidence(baseEvidence({ topology_source: 'INFERRED', ambiguous_edge: false }));
    expect(result.level).toBe('MEDIUM');
    expect(result.reasons.some(r => r.code === 'INFERRED_TOPOLOGY')).toBe(true);
  });

  it('missing-device gap (has_range=true) → MEDIUM with reason MISSING_DEVICE_GAP', () => {
    const result = evaluateConfidence(baseEvidence({
      has_range: true,
      range_pole_count: 2,      // well below cutoff of 10
      has_unmonitored_gap: true,
    }));
    expect(result.level).toBe('MEDIUM');
    expect(result.reasons.some(r => r.code === 'MISSING_DEVICE_GAP')).toBe(true);
  });

  it('heartbeat-timeout evidence (fw>=1.3) → MEDIUM with HEARTBEAT_TIMEOUT_EVIDENCE', () => {
    const result = evaluateConfidence(baseEvidence({
      evidence_heartbeat_only: true,
      evidence_fw12_only: false,
    }));
    expect(result.level).toBe('MEDIUM');
    expect(result.reasons.some(r => r.code === 'HEARTBEAT_TIMEOUT_EVIDENCE')).toBe(true);
  });

  it('scheduled-outage overlap → MEDIUM with SCHEDULED_OUTAGE_OVERLAP', () => {
    const result = evaluateConfidence(baseEvidence({ scheduled_outage_overlap: true }));
    expect(result.level).toBe('MEDIUM');
    expect(result.reasons.some(r => r.code === 'SCHEDULED_OUTAGE_OVERLAP')).toBe(true);
  });

  it('small RANGE exactly at cutoff → MEDIUM not LOW (boundary condition)', () => {
    // gap_pole_count == RANGE_LOW_CONFIDENCE_POLE_CUTOFF is NOT > cutoff, so MEDIUM
    const result = evaluateConfidence(baseEvidence({
      has_range: true,
      range_pole_count: RANGE_LOW_CONFIDENCE_POLE_CUTOFF,  // exactly AT boundary
      has_unmonitored_gap: true,
    }));
    expect(result.level).toBe('MEDIUM');
  });

  it('multiple MEDIUM triggers → stays MEDIUM and all reasons are present', () => {
    const result = evaluateConfidence(baseEvidence({
      topology_source: 'INFERRED',
      ambiguous_edge: false,
      evidence_heartbeat_only: true,
      evidence_fw12_only: false,
      scheduled_outage_overlap: true,
    }));
    expect(result.level).toBe('MEDIUM');
    const codes = result.reasons.map(r => r.code);
    expect(codes).toContain('INFERRED_TOPOLOGY');
    expect(codes).toContain('HEARTBEAT_TIMEOUT_EVIDENCE');
    expect(codes).toContain('SCHEDULED_OUTAGE_OVERLAP');
  });
});

// ─── LOW confidence ───────────────────────────────────────────────────────────

describe('LOW confidence (Section I)', () => {

  it('INFERRED + ambiguous edge → LOW with INFERRED_AMBIGUOUS', () => {
    const result = evaluateConfidence(baseEvidence({
      topology_source: 'INFERRED',
      ambiguous_edge: true,
    }));
    expect(result.level).toBe('LOW');
    expect(result.reasons.some(r => r.code === 'INFERRED_AMBIGUOUS')).toBe(true);
  });

  it('RANGE exceeds cutoff (cutoff+1) → LOW with RANGE_TOO_LARGE', () => {
    const result = evaluateConfidence(baseEvidence({
      has_range: true,
      range_pole_count: RANGE_LOW_CONFIDENCE_POLE_CUTOFF + 1,  // one over
      has_unmonitored_gap: true,
    }));
    expect(result.level).toBe('LOW');
    expect(result.reasons.some(r => r.code === 'RANGE_TOO_LARGE')).toBe(true);
  });

  it('fw<1.3 timeout ONLY with no corroboration → LOW with FW12_TIMEOUT_ONLY', () => {
    const result = evaluateConfidence(baseEvidence({
      evidence_heartbeat_only: true,
      evidence_fw12_only: true,
    }));
    expect(result.level).toBe('LOW');
    expect(result.reasons.some(r => r.code === 'FW12_TIMEOUT_ONLY')).toBe(true);
  });

  it('SENSOR_SUSPECT (conflicting subtree) → LOW with SENSOR_SUSPECT_PRESENT', () => {
    const result = evaluateConfidence(baseEvidence({ has_sensor_suspect: true }));
    expect(result.level).toBe('LOW');
    expect(result.reasons.some(r => r.code === 'SENSOR_SUSPECT_PRESENT')).toBe(true);
  });

  it('RANGE exceeds cutoff exactly at cutoff+1 (threshold boundary)', () => {
    const result = evaluateConfidence(baseEvidence({
      has_range: true,
      range_pole_count: RANGE_LOW_CONFIDENCE_POLE_CUTOFF + 1,
    }));
    expect(result.level).toBe('LOW');
  });
});

// ─── Precedence: LOW beats MEDIUM ─────────────────────────────────────────────

describe('Precedence — LOW beats MEDIUM (Section I: "rule precedence")', () => {

  it('LOW + MEDIUM combination resolves to LOW — ambiguous INFERRED + heartbeat', () => {
    // INFERRED+ambiguous = LOW trigger; INFERRED non-ambiguous = MEDIUM trigger
    // LOW must win
    const result = evaluateConfidence(baseEvidence({
      topology_source: 'INFERRED',
      ambiguous_edge: true,
      evidence_heartbeat_only: true, // also a MEDIUM condition
    }));
    expect(result.level).toBe('LOW');
    expect(result.reasons.some(r => r.code === 'INFERRED_AMBIGUOUS')).toBe(true);
    // MEDIUM reason should NOT appear since LOW wins first
    expect(result.reasons.some(r => r.code === 'HEARTBEAT_TIMEOUT_EVIDENCE')).toBe(false);
    expect(result.reasons.some(r => r.code === 'INFERRED_TOPOLOGY')).toBe(false);
  });

  it('fw12 only + INFERRED topology → LOW wins over MEDIUM', () => {
    const result = evaluateConfidence(baseEvidence({
      topology_source: 'INFERRED',
      evidence_fw12_only: true,
      evidence_heartbeat_only: true,
    }));
    expect(result.level).toBe('LOW');
    expect(result.reasons.some(r => r.code === 'FW12_TIMEOUT_ONLY')).toBe(true);
  });

  it('large RANGE + scheduled outage → LOW wins over MEDIUM', () => {
    const result = evaluateConfidence(baseEvidence({
      has_range: true,
      range_pole_count: RANGE_LOW_CONFIDENCE_POLE_CUTOFF + 5,
      scheduled_outage_overlap: true,
    }));
    expect(result.level).toBe('LOW');
    expect(result.reasons.some(r => r.code === 'RANGE_TOO_LARGE')).toBe(true);
  });
});

// ─── fw<1.3 corroboration tests ───────────────────────────────────────────────

describe('fw<1.3 corroboration rule — must NOT trigger LOW when corroboration exists (Section I)', () => {

  it('fw12 + fw13 timeouts (mixed) → MEDIUM (not LOW), because not "solely" fw12', () => {
    // Both are timeouts → heartbeat_only=true; but not all fw12 → fw12_only=false → MEDIUM
    const result = evaluateConfidence(baseEvidence({
      evidence_heartbeat_only: true,
      evidence_fw12_only: false,  // some poles are fw13 timeout → corroboration via fw13 exists
    }));
    expect(result.level).toBe('MEDIUM');
    expect(result.reasons.some(r => r.code === 'HEARTBEAT_TIMEOUT_EVIDENCE')).toBe(true);
    expect(result.reasons.some(r => r.code === 'FW12_TIMEOUT_ONLY')).toBe(false);
  });

  it('fw12 timeout + power_lost corroboration → NOT fw12_only → evidence_fw12_only=false', () => {
    // power_lost on even one pole means evidence_fw12_only must be false
    const edge = { parent_pole_id: 'P1', child_pole_id: 'P2', source: 'AUTHORITATIVE', ambiguous: false };
    const poleStates = new Map([
      ['P2', { status: 'CONFIRMED_DARK', evidence_type: 'timeout_fw12' }],
      ['P3', { status: 'CONFIRMED_DARK', evidence_type: 'power_lost' }], // corroboration
    ]);
    const evidence = buildConfidenceEvidence(edge, null, [], false, poleStates, ['P2', 'P3']);
    expect(evidence.evidence_fw12_only).toBe(false);
    expect(evidence.evidence_heartbeat_only).toBe(false);

    const result = evaluateConfidence(evidence);
    expect(result.level).toBe('HIGH'); // power_lost means HIGH (no downgrade conditions left)
    expect(result.reasons.some(r => r.code === 'FW12_TIMEOUT_ONLY')).toBe(false);
  });

  it('fw12 timeout ONLY, no other poles, no corroboration → LOW', () => {
    const edge = { parent_pole_id: 'P1', child_pole_id: 'P2', source: 'AUTHORITATIVE', ambiguous: false };
    const poleStates = new Map([
      ['P2', { status: 'CONFIRMED_DARK', evidence_type: 'timeout_fw12' }],
    ]);
    const evidence = buildConfidenceEvidence(edge, null, [], false, poleStates, ['P2']);
    expect(evidence.evidence_fw12_only).toBe(true);

    const result = evaluateConfidence(evidence);
    expect(result.level).toBe('LOW');
    expect(result.reasons.some(r => r.code === 'FW12_TIMEOUT_ONLY')).toBe(true);
  });

  it('fw12 + fw13 mix → evidence uses structured evidence_type NOT string parsing', () => {
    // This test validates that the evidence_type field (structured) drives the logic,
    // NOT the human-readable evidence_summary string.
    const edge = { parent_pole_id: 'P1', child_pole_id: 'P2', source: 'AUTHORITATIVE', ambiguous: false };
    const poleStates = new Map([
      // evidence_summary deliberately says "heartbeat" to confuse any legacy string-parsing code
      ['P2', { status: 'CONFIRMED_DARK', evidence_type: 'timeout_fw12', evidence_summary: 'Missing heartbeat (fw < 1.3)' }],
      ['P3', { status: 'CONFIRMED_DARK', evidence_type: 'timeout_fw13', evidence_summary: 'Missing heartbeat (fw >= 1.3)' }],
    ]);
    const evidence = buildConfidenceEvidence(edge, null, [], false, poleStates, ['P2', 'P3']);

    // The decision MUST be driven by evidence_type, not evidence_summary
    expect(evidence.evidence_fw12_only).toBe(false); // fw13 corroborates
    expect(evidence.evidence_heartbeat_only).toBe(true); // both are timeouts
  });
});

// ─── buildConfidenceEvidence — topology/ambiguous pass-through ────────────────

describe('buildConfidenceEvidence — topology source and ambiguous pass-through', () => {

  it('passes INFERRED source from frontierEdge', () => {
    const edge = { parent_pole_id: 'P1', child_pole_id: 'P2', source: 'INFERRED', ambiguous: false };
    const evidence = buildConfidenceEvidence(edge);
    expect(evidence.topology_source).toBe('INFERRED');
    expect(evidence.ambiguous_edge).toBe(false);
  });

  it('passes ambiguous=true from frontierEdge', () => {
    const edge = { parent_pole_id: 'P1', child_pole_id: 'P2', source: 'INFERRED', ambiguous: true };
    const evidence = buildConfidenceEvidence(edge);
    expect(evidence.ambiguous_edge).toBe(true);
  });

  it('sets has_range=true and range_pole_count from rangeIncident', () => {
    const edge = { parent_pole_id: 'P1', child_pole_id: 'P2', source: 'AUTHORITATIVE', ambiguous: false };
    const rangeIncident = { gap_pole_count: 5 };
    const evidence = buildConfidenceEvidence(edge, rangeIncident);
    expect(evidence.has_range).toBe(true);
    expect(evidence.range_pole_count).toBe(5);
  });

  it('sets has_sensor_suspect=true when sensorSuspects list is non-empty', () => {
    const edge = { parent_pole_id: 'P1', child_pole_id: 'P2', source: 'AUTHORITATIVE', ambiguous: false };
    const evidence = buildConfidenceEvidence(edge, null, ['P3_suspect']);
    expect(evidence.has_sensor_suspect).toBe(true);
  });

  it('sets scheduled_outage_overlap correctly', () => {
    const edge = { parent_pole_id: 'P1', child_pole_id: 'P2', source: 'AUTHORITATIVE', ambiguous: false };
    const evidenceWithOutage = buildConfidenceEvidence(edge, null, [], true);
    expect(evidenceWithOutage.scheduled_outage_overlap).toBe(true);

    const evidenceWithout = buildConfidenceEvidence(edge, null, [], false);
    expect(evidenceWithout.scheduled_outage_overlap).toBe(false);
  });

  it('falls back to child_pole_id when affectedPoleIds is empty', () => {
    const edge = { parent_pole_id: 'P1', child_pole_id: 'P2', source: 'AUTHORITATIVE', ambiguous: false };
    const poleStates = new Map([
      ['P2', { status: 'CONFIRMED_DARK', evidence_type: 'power_lost' }],
    ]);
    const evidence = buildConfidenceEvidence(edge, null, [], false, poleStates, []);
    // power_lost → not heartbeat, not fw12
    expect(evidence.evidence_heartbeat_only).toBe(false);
    expect(evidence.evidence_fw12_only).toBe(false);
  });

  it('evidence_heartbeat_only=false and fw12_only=false when no monitored poles have evidence_type set', () => {
    // Degenerate case: poles in map but none with evidence_type → hasMonitored stays false → both false
    const edge = { parent_pole_id: 'P1', child_pole_id: 'P2', source: 'AUTHORITATIVE', ambiguous: false };
    const poleStates = new Map([
      ['P2', { status: 'CONFIRMED_DARK' }], // evidence_type missing (old format)
    ]);
    const evidence = buildConfidenceEvidence(edge, null, [], false, poleStates, ['P2']);
    expect(evidence.evidence_heartbeat_only).toBe(false);
    expect(evidence.evidence_fw12_only).toBe(false);
  });
});

// ─── Full pipeline integration: buildConfidenceEvidence + evaluateConfidence ──

describe('Full pipeline integration (Section I scenarios)', () => {

  it('Scenario A: clean AUTHORITATIVE + power_lost → HIGH', () => {
    const edge = { parent_pole_id: 'P1', child_pole_id: 'P2', source: 'AUTHORITATIVE', ambiguous: false };
    const states = new Map([['P2', { status: 'CONFIRMED_DARK', evidence_type: 'power_lost' }]]);
    const evidence = buildConfidenceEvidence(edge, null, [], false, states, ['P2']);
    const result = evaluateConfidence(evidence);
    expect(result.level).toBe('HIGH');
  });

  it('Scenario B: INFERRED non-ambiguous + power_lost → MEDIUM (INFERRED_TOPOLOGY)', () => {
    const edge = { parent_pole_id: 'P1', child_pole_id: 'P2', source: 'INFERRED', ambiguous: false };
    const states = new Map([['P2', { status: 'CONFIRMED_DARK', evidence_type: 'power_lost' }]]);
    const evidence = buildConfidenceEvidence(edge, null, [], false, states, ['P2']);
    const result = evaluateConfidence(evidence);
    expect(result.level).toBe('MEDIUM');
    expect(result.reasons.some(r => r.code === 'INFERRED_TOPOLOGY')).toBe(true);
  });

  it('Scenario C: INFERRED + ambiguous → LOW (INFERRED_AMBIGUOUS) even with power_lost evidence', () => {
    const edge = { parent_pole_id: 'P1', child_pole_id: 'P2', source: 'INFERRED', ambiguous: true };
    const states = new Map([['P2', { status: 'CONFIRMED_DARK', evidence_type: 'power_lost' }]]);
    const evidence = buildConfidenceEvidence(edge, null, [], false, states, ['P2']);
    const result = evaluateConfidence(evidence);
    expect(result.level).toBe('LOW');
    expect(result.reasons.some(r => r.code === 'INFERRED_AMBIGUOUS')).toBe(true);
  });

  it('Scenario D: small RANGE + AUTHORITATIVE + power_lost → MEDIUM (MISSING_DEVICE_GAP)', () => {
    const edge = { parent_pole_id: 'P1', child_pole_id: 'U_gap', source: 'AUTHORITATIVE', ambiguous: false };
    const rangeIncident = { gap_pole_count: 3 }; // below cutoff
    const states = new Map([['P_dark', { status: 'CONFIRMED_DARK', evidence_type: 'power_lost' }]]);
    const evidence = buildConfidenceEvidence(edge, rangeIncident, [], false, states, ['P_dark']);
    const result = evaluateConfidence(evidence);
    expect(result.level).toBe('MEDIUM');
    expect(result.reasons.some(r => r.code === 'MISSING_DEVICE_GAP')).toBe(true);
  });

  it('Scenario E: RANGE > cutoff → LOW (RANGE_TOO_LARGE) — Section I threshold', () => {
    const edge = { parent_pole_id: 'P1', child_pole_id: 'U_gap', source: 'AUTHORITATIVE', ambiguous: false };
    const rangeIncident = { gap_pole_count: RANGE_LOW_CONFIDENCE_POLE_CUTOFF + 1 };
    const evidence = buildConfidenceEvidence(edge, rangeIncident);
    const result = evaluateConfidence(evidence);
    expect(result.level).toBe('LOW');
    expect(result.reasons.some(r => r.code === 'RANGE_TOO_LARGE')).toBe(true);
  });

  it('Scenario F: sensor suspect present → LOW (SENSOR_SUSPECT_PRESENT)', () => {
    const edge = { parent_pole_id: 'P1', child_pole_id: 'P2', source: 'AUTHORITATIVE', ambiguous: false };
    const evidence = buildConfidenceEvidence(edge, null, ['P3_suspect']);
    const result = evaluateConfidence(evidence);
    expect(result.level).toBe('LOW');
    expect(result.reasons.some(r => r.code === 'SENSOR_SUSPECT_PRESENT')).toBe(true);
  });

  it('Scenario G: scheduled outage + AUTHORITATIVE + power_lost → MEDIUM', () => {
    const edge = { parent_pole_id: 'P1', child_pole_id: 'P2', source: 'AUTHORITATIVE', ambiguous: false };
    const states = new Map([['P2', { status: 'CONFIRMED_DARK', evidence_type: 'power_lost' }]]);
    const evidence = buildConfidenceEvidence(edge, null, [], true, states, ['P2']);
    const result = evaluateConfidence(evidence);
    expect(result.level).toBe('MEDIUM');
    expect(result.reasons.some(r => r.code === 'SCHEDULED_OUTAGE_OVERLAP')).toBe(true);
  });
});
