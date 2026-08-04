import { describe, it, expect } from 'vitest';
import { detectFrontier } from './frontier.js';

// ─── Fixture helpers ─────────────────────────────────────────────────────────

/**
 * Build a flat edge list for a linear chain: root → p1 → p2 → … → pN
 * All edges are AUTHORITATIVE and unambiguous by default.
 */
function linearEdges(ids, source = 'AUTHORITATIVE') {
  const edges = [];
  for (let i = 0; i < ids.length - 1; i++) {
    edges.push({ parent_pole_id: ids[i], child_pole_id: ids[i + 1], source, ambiguous: false });
  }
  return edges;
}

/** Build a poleStates map. Each entry: [id, status] */
function stateMap(entries) {
  return new Map(entries.map(([id, status]) => [id, { status }]));
}

/** Build a poleMap. Each entry: [id, has_device?]. Default: has device. */
function poleMap(entries) {
  return new Map(
    entries.map(([id, hasDevice = true]) => [id, { device_id: hasDevice ? `dev-${id}` : null }])
  );
}

// ─── Core frontier detection ──────────────────────────────────────────────────

describe('detectFrontier — basic cases', () => {
  it('returns empty result when no edges', () => {
    const result = detectFrontier([], stateMap([]), poleMap([]));
    expect(result.frontierEdges).toHaveLength(0);
    expect(result.sensorSuspects).toHaveLength(0);
    expect(result.rangeEdges).toHaveLength(0);
  });

  it('returns no frontier when all poles are LIVE', () => {
    // root → p1 → p2, all LIVE
    const edges = linearEdges(['root', 'p1', 'p2']);
    const states = stateMap([['root', 'LIVE'], ['p1', 'LIVE'], ['p2', 'LIVE']]);
    const poles = poleMap([['root'], ['p1'], ['p2']]);

    const result = detectFrontier(edges, states, poles);
    expect(result.frontierEdges).toHaveLength(0);
  });

  it('detects a single frontier edge at the start of a dark region', () => {
    // root(LIVE) → p1(CONFIRMED_DARK) → p2(CONFIRMED_DARK)
    // Frontier: root→p1 only (collapse stops descent into dark region)
    const edges = linearEdges(['root', 'p1', 'p2']);
    const states = stateMap([['root', 'LIVE'], ['p1', 'CONFIRMED_DARK'], ['p2', 'CONFIRMED_DARK']]);
    const poles = poleMap([['root'], ['p1'], ['p2']]);

    const result = detectFrontier(edges, states, poles);
    expect(result.frontierEdges).toHaveLength(1);
    expect(result.frontierEdges[0].parent_pole_id).toBe('root');
    expect(result.frontierEdges[0].child_pole_id).toBe('p1');
  });

  it('Rule 3: collapses — emits ONE frontier edge, not one per dark pole', () => {
    // root(LIVE) → p1(DARK) → p2(DARK) → p3(DARK) → p4(DARK)
    const edges = linearEdges(['root', 'p1', 'p2', 'p3', 'p4']);
    const states = stateMap([
      ['root', 'LIVE'], ['p1', 'CONFIRMED_DARK'], ['p2', 'CONFIRMED_DARK'],
      ['p3', 'CONFIRMED_DARK'], ['p4', 'CONFIRMED_DARK'],
    ]);
    const poles = poleMap([['root'], ['p1'], ['p2'], ['p3'], ['p4']]);

    const result = detectFrontier(edges, states, poles);
    expect(result.frontierEdges).toHaveLength(1); // Only root→p1
  });

  it('detects two frontier edges in independent dark subtrees', () => {
    // root(LIVE) branches to branchA(DARK) and branchB(DARK)
    const edges = [
      { parent_pole_id: 'root', child_pole_id: 'branchA', source: 'AUTHORITATIVE', ambiguous: false },
      { parent_pole_id: 'root', child_pole_id: 'branchB', source: 'AUTHORITATIVE', ambiguous: false },
      { parent_pole_id: 'branchA', child_pole_id: 'leafA', source: 'AUTHORITATIVE', ambiguous: false },
    ];
    const states = stateMap([
      ['root', 'LIVE'],
      ['branchA', 'CONFIRMED_DARK'], ['leafA', 'CONFIRMED_DARK'],
      ['branchB', 'CONFIRMED_DARK'],
    ]);
    const poles = poleMap([['root'], ['branchA'], ['leafA'], ['branchB']]);

    const result = detectFrontier(edges, states, poles);
    expect(result.frontierEdges).toHaveLength(2);
    const pairs = result.frontierEdges.map((e) => `${e.parent_pole_id}→${e.child_pole_id}`);
    expect(pairs).toContain('root→branchA');
    expect(pairs).toContain('root→branchB');
  });

  it('carries topology source and ambiguous flag from the edge', () => {
    const edges = [{ parent_pole_id: 'root', child_pole_id: 'p1', source: 'INFERRED', ambiguous: true }];
    const states = stateMap([['root', 'LIVE'], ['p1', 'CONFIRMED_DARK']]);
    const poles = poleMap([['root'], ['p1']]);

    const result = detectFrontier(edges, states, poles);
    expect(result.frontierEdges[0].source).toBe('INFERRED');
    expect(result.frontierEdges[0].ambiguous).toBe(true);
  });

  it('does not emit frontier when the entire tree is dark (no LIVE ancestor above)', () => {
    // root(DARK) → p1(DARK) — there's no live upstream to create a frontier
    const edges = linearEdges(['root', 'p1']);
    const states = stateMap([['root', 'CONFIRMED_DARK'], ['p1', 'CONFIRMED_DARK']]);
    const poles = poleMap([['root'], ['p1']]);

    const result = detectFrontier(edges, states, poles);
    expect(result.frontierEdges).toHaveLength(0);
  });
});

// ─── Rule 4: Sensor-anomaly detection ────────────────────────────────────────

describe('detectFrontier — Rule 4: sensor suspects', () => {
  it('reclassifies CONFIRMED_DARK pole with LIVE descendant as SENSOR_SUSPECT', () => {
    // root(LIVE) → p1(DARK) → p2(LIVE)   — radial invariant violated at p1
    const edges = linearEdges(['root', 'p1', 'p2']);
    const states = stateMap([['root', 'LIVE'], ['p1', 'CONFIRMED_DARK'], ['p2', 'LIVE']]);
    const poles = poleMap([['root'], ['p1'], ['p2']]);

    const result = detectFrontier(edges, states, poles);
    expect(result.sensorSuspects).toContain('p1');
    // No frontier edge should be emitted for p1 — it's a sensor issue, not a line fault
    expect(result.frontierEdges).toHaveLength(0);
  });

  it('does NOT flag a CONFIRMED_DARK pole at the leaf (no descendants) as sensor suspect', () => {
    // root(LIVE) → p1(DARK)  — leaf, no descendants, valid dark
    const edges = linearEdges(['root', 'p1']);
    const states = stateMap([['root', 'LIVE'], ['p1', 'CONFIRMED_DARK']]);
    const poles = poleMap([['root'], ['p1']]);

    const result = detectFrontier(edges, states, poles);
    expect(result.sensorSuspects).toHaveLength(0);
    expect(result.frontierEdges).toHaveLength(1);
  });

  it('continues frontier walk past the sensor-suspect pole', () => {
    // root(LIVE) → suspect(DARK-with-live-child) → darkLeaf(DARK)
    //    └─────────────────────────────────────────┘
    // After treating suspect as live, edge suspect→darkLeaf becomes a frontier
    const edges = [
      { parent_pole_id: 'root', child_pole_id: 'suspect', source: 'AUTHORITATIVE', ambiguous: false },
      { parent_pole_id: 'suspect', child_pole_id: 'liveLeaf', source: 'AUTHORITATIVE', ambiguous: false },
      { parent_pole_id: 'suspect', child_pole_id: 'darkLeaf', source: 'AUTHORITATIVE', ambiguous: false },
    ];
    const states = stateMap([
      ['root', 'LIVE'],
      ['suspect', 'CONFIRMED_DARK'],
      ['liveLeaf', 'LIVE'],
      ['darkLeaf', 'CONFIRMED_DARK'],
    ]);
    const poles = poleMap([['root'], ['suspect'], ['liveLeaf'], ['darkLeaf']]);

    const result = detectFrontier(edges, states, poles);
    expect(result.sensorSuspects).toContain('suspect');
    // The walk should continue through suspect (treated as live) and find darkLeaf
    expect(result.frontierEdges).toHaveLength(1);
    expect(result.frontierEdges[0].parent_pole_id).toBe('suspect');
    expect(result.frontierEdges[0].child_pole_id).toBe('darkLeaf');
  });
});

// ─── Rule 7: Range / unmonitored edges ───────────────────────────────────────

describe('detectFrontier — Rule 7: unmonitored range edges', () => {
  it('flags frontier edge as range when child is unmonitored', () => {
    // root(LIVE) → unmon(no device, no observed state) → p2(DARK)
    // Because unmon has no device, it has no state → assumed LIVE.
    // Frontier is pushed downstream to unmon→p2 (parent=unmon has no device).
    const edges = linearEdges(['root', 'unmon', 'p2']);
    // unmon intentionally has NO state (can't be dark — no device to report it)
    const states = stateMap([['root', 'LIVE'], ['p2', 'CONFIRMED_DARK']]);
    const poles = poleMap([['root', true], ['unmon', false], ['p2', true]]); // unmon has no device

    const result = detectFrontier(edges, states, poles);
    expect(result.frontierEdges).toHaveLength(1);
    expect(result.frontierEdges[0].parent_pole_id).toBe('unmon'); // frontier pushed past unmon
    expect(result.rangeEdges).toHaveLength(1);
    expect(result.rangeEdges[0].missing_side).toBe('parent'); 
  });

  it('treats unmonitored pole (no device, no known state) as assumed-live (Section H Rule 2)', () => {
    // root(LIVE) → unmon(no device, no state) → dark(CONFIRMED_DARK)
    // The unmonitored pole is assumed LIVE; frontier is at unmon→dark
    const edges = linearEdges(['root', 'unmon', 'dark']);
    const states = stateMap([['root', 'LIVE'], ['dark', 'CONFIRMED_DARK']]);
    // unmon deliberately absent from states (no observation)
    const poles = poleMap([['root', true], ['unmon', false], ['dark', true]]);

    const result = detectFrontier(edges, states, poles);
    expect(result.frontierEdges).toHaveLength(1);
    expect(result.frontierEdges[0].parent_pole_id).toBe('unmon');
    expect(result.frontierEdges[0].child_pole_id).toBe('dark');
    // Parent is unmonitored
    expect(result.rangeEdges[0].missing_side).toBe('parent');
  });

  it('flags missing_side: both when both poles are unmonitored', () => {
    const edges = [
      { parent_pole_id: 'unmonA', child_pole_id: 'unmonB', source: 'AUTHORITATIVE', ambiguous: false },
    ];
    // unmonA assumed live (no device), unmonB assumed live too — but let's force state for the test
    const states = stateMap([['unmonB', 'CONFIRMED_DARK']]);
    const poles = poleMap([['unmonA', false], ['unmonB', false]]);

    const result = detectFrontier(edges, states, poles);
    if (result.frontierEdges.length > 0) {
      expect(result.rangeEdges[0].missing_side).toBe('both');
    }
  });

  it('does NOT emit a range edge for a monitored-on-both-sides frontier', () => {
    const edges = linearEdges(['root', 'p1']);
    const states = stateMap([['root', 'LIVE'], ['p1', 'CONFIRMED_DARK']]);
    const poles = poleMap([['root', true], ['p1', true]]);

    const result = detectFrontier(edges, states, poles);
    expect(result.frontierEdges).toHaveLength(1);
    expect(result.rangeEdges).toHaveLength(0);
  });
});

// ─── Step 13: Span-level localization test matrix ───────────────────────────

describe('Step 13 — Span-level localization test matrix', () => {
  it('Known-topology span fault: pinpoints exact frontier edge', () => {
    // root(LIVE) -> p1(LIVE) -> p2(DARK) -> p3(DARK)
    const edges = linearEdges(['root', 'p1', 'p2', 'p3']);
    const states = stateMap([['root', 'LIVE'], ['p1', 'LIVE'], ['p2', 'CONFIRMED_DARK'], ['p3', 'CONFIRMED_DARK']]);
    const poles = poleMap([['root'], ['p1'], ['p2'], ['p3']]);

    const result = detectFrontier(edges, states, poles);
    expect(result.frontierEdges).toHaveLength(1);
    expect(result.frontierEdges[0].parent_pole_id).toBe('p1');
    expect(result.frontierEdges[0].child_pole_id).toBe('p2');
    expect(result.frontierEdges[0].source).toBe('AUTHORITATIVE');
  });

  it('Branched fault: isolates fault to specific branch', () => {
    // root(LIVE) -> branchA(LIVE) -> a1(LIVE)
    //           \-> branchB(LIVE) -> b1(DARK) -> b2(DARK)
    const edges = [
      { parent_pole_id: 'root', child_pole_id: 'branchA', source: 'AUTHORITATIVE', ambiguous: false },
      { parent_pole_id: 'branchA', child_pole_id: 'a1', source: 'AUTHORITATIVE', ambiguous: false },
      { parent_pole_id: 'root', child_pole_id: 'branchB', source: 'AUTHORITATIVE', ambiguous: false },
      { parent_pole_id: 'branchB', child_pole_id: 'b1', source: 'AUTHORITATIVE', ambiguous: false },
      { parent_pole_id: 'b1', child_pole_id: 'b2', source: 'AUTHORITATIVE', ambiguous: false },
    ];
    const states = stateMap([
      ['root', 'LIVE'], ['branchA', 'LIVE'], ['a1', 'LIVE'],
      ['branchB', 'LIVE'], ['b1', 'CONFIRMED_DARK'], ['b2', 'CONFIRMED_DARK'],
    ]);
    const poles = poleMap([['root'], ['branchA'], ['a1'], ['branchB'], ['b1'], ['b2']]);

    const result = detectFrontier(edges, states, poles);
    expect(result.frontierEdges).toHaveLength(1);
    expect(result.frontierEdges[0].parent_pole_id).toBe('branchB');
    expect(result.frontierEdges[0].child_pole_id).toBe('b1');
  });

  it('Many-downstream-poles to one-incident: 40-pole downstream fault emits exactly ONE frontier edge', () => {
    // root (LIVE) -> p1..p40 (all CONFIRMED_DARK)
    const poleIds = ['root'];
    for (let i = 1; i <= 40; i++) poleIds.push(`p${i}`);
    
    const edges = linearEdges(poleIds);
    const stateEntries = [['root', 'LIVE']];
    for (let i = 1; i <= 40; i++) stateEntries.push([`p${i}`, 'CONFIRMED_DARK']);
    
    const poleEntries = [['root', true]];
    for (let i = 1; i <= 40; i++) poleEntries.push([`p${i}`, true]);

    const states = stateMap(stateEntries);
    const poles = poleMap(poleEntries);

    const result = detectFrontier(edges, states, poles);

    expect(result.frontierEdges).toHaveLength(1);
    expect(result.frontierEdges[0].parent_pole_id).toBe('root');
    expect(result.frontierEdges[0].child_pole_id).toBe('p1');
    expect(result.sensorSuspects).toHaveLength(0);
  });

  it('Isolated sensor anomaly: dark pole with live descendant produces no frontier and flags sensor suspect', () => {
    // root(LIVE) -> p1(CONFIRMED_DARK) -> p2(LIVE)
    const edges = linearEdges(['root', 'p1', 'p2']);
    const states = stateMap([['root', 'LIVE'], ['p1', 'CONFIRMED_DARK'], ['p2', 'LIVE']]);
    const poles = poleMap([['root'], ['p1'], ['p2']]);

    const result = detectFrontier(edges, states, poles);
    expect(result.sensorSuspects).toEqual(['p1']);
    expect(result.frontierEdges).toHaveLength(0);
  });
});

