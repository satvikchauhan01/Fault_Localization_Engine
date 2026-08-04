import { describe, it, expect } from 'vitest';
import { evaluateDtRollup, evaluateFeederRollup, applyRollup } from './rollup.js';

// ─── Fixture helpers ─────────────────────────────────────────────────────────

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

/** Build N pole IDs all belonging to the same DT */
function makePoles(count, prefix = 'p') {
  return Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);
}

// ─── evaluateDtRollup ─────────────────────────────────────────────────────────

describe('evaluateDtRollup', () => {
  it('fires DT_FAULT when ≥90% of monitored poles are CONFIRMED_DARK and no LIVE pole', () => {
    const ids = makePoles(10); // p1..p10
    const states = stateMap(ids.map((id) => [id, 'CONFIRMED_DARK']));
    const poles = poleMap(ids.map((id) => [id, true]));

    const result = evaluateDtRollup('dt-1', ids, states, poles);
    expect(result).not.toBeNull();
    expect(result.type).toBe('DT_FAULT');
    expect(result.target_id).toBe('dt-1');
    expect(result.dark_ratio).toBe(1.0);
    expect(result.has_live_pole).toBe(false);
  });

  it('fires at exactly 90% (9/10 dark)', () => {
    const ids = makePoles(10);
    const states = stateMap(ids.slice(0, 9).map((id) => [id, 'CONFIRMED_DARK']));
    // p10 has no state entry → counted as neither dark nor live
    const poles = poleMap(ids.map((id) => [id, true]));

    const result = evaluateDtRollup('dt-1', ids, states, poles);
    // 9/10 = 0.9, which is exactly >= 0.90, and no LIVE
    expect(result).not.toBeNull();
    expect(result.dark_ratio).toBe(0.9);
  });

  it('does NOT fire when <90% dark (8/10)', () => {
    const ids = makePoles(10);
    const states = stateMap(ids.slice(0, 8).map((id) => [id, 'CONFIRMED_DARK']));
    const poles = poleMap(ids.map((id) => [id, true]));

    const result = evaluateDtRollup('dt-1', ids, states, poles);
    expect(result).toBeNull();
  });

  it('does NOT fire when any LIVE pole is observed', () => {
    const ids = makePoles(10);
    // 9 dark, 1 LIVE — threshold met but LIVE veto applies
    const states = stateMap([
      ...ids.slice(0, 9).map((id) => [id, 'CONFIRMED_DARK']),
      [ids[9], 'LIVE'],
    ]);
    const poles = poleMap(ids.map((id) => [id, true]));

    const result = evaluateDtRollup('dt-1', ids, states, poles);
    expect(result).toBeNull();
  });

  it('excludes unmonitored poles from the denominator', () => {
    // 10 poles total, 2 unmonitored. 8 monitored, 8 dark → 100%
    const ids = makePoles(10);
    const states = stateMap(ids.slice(0, 8).map((id) => [id, 'CONFIRMED_DARK']));
    const poles = poleMap(ids.map((id, i) => [id, i < 8])); // p9, p10 unmonitored

    const result = evaluateDtRollup('dt-1', ids, states, poles);
    expect(result).not.toBeNull();
    expect(result.monitored_count).toBe(8);
    expect(result.dark_count).toBe(8);
    expect(result.dark_ratio).toBe(1.0);
  });

  it('returns null when no monitored poles exist', () => {
    const ids = makePoles(5);
    const states = stateMap([]);
    const poles = poleMap(ids.map((id) => [id, false])); // all unmonitored

    const result = evaluateDtRollup('dt-1', ids, states, poles);
    expect(result).toBeNull();
  });

  it('includes only CONFIRMED_DARK poles in affected_pole_ids', () => {
    const ids = makePoles(10);
    // 9 dark, 1 without state (treated as neither dark nor live)
    const states = stateMap(ids.slice(0, 9).map((id) => [id, 'CONFIRMED_DARK']));
    const poles = poleMap(ids.map((id) => [id, true]));

    const result = evaluateDtRollup('dt-1', ids, states, poles);
    expect(result).not.toBeNull();
    expect(result.affected_pole_ids).toHaveLength(9);
    expect(result.affected_pole_ids).not.toContain('p10');
  });
});

// ─── evaluateFeederRollup ─────────────────────────────────────────────────────

describe('evaluateFeederRollup', () => {
  it('fires FEEDER_FAULT when ≥90% of all feeder poles are dark across multiple DTs', () => {
    // 2 DTs, 5 poles each, all dark
    const dtIds = ['dt-a', 'dt-b'];
    const dtPoleMap = new Map([
      ['dt-a', makePoles(5, 'a')],
      ['dt-b', makePoles(5, 'b')],
    ]);
    const allPoles = [...makePoles(5, 'a'), ...makePoles(5, 'b')];
    const states = stateMap(allPoles.map((id) => [id, 'CONFIRMED_DARK']));
    const poles = poleMap(allPoles.map((id) => [id, true]));

    const { feederRollup, dtRollups } = evaluateFeederRollup('feeder-1', dtIds, dtPoleMap, states, poles);

    expect(feederRollup).not.toBeNull();
    expect(feederRollup.type).toBe('FEEDER_FAULT');
    expect(feederRollup.target_id).toBe('feeder-1');
    expect(feederRollup.dark_count).toBe(10);
    expect(dtRollups.size).toBe(2);
  });

  it('does NOT fire FEEDER_FAULT when one DT has a LIVE pole', () => {
    const dtIds = ['dt-a', 'dt-b'];
    const dtPoleMap = new Map([
      ['dt-a', makePoles(5, 'a')],
      ['dt-b', makePoles(5, 'b')],
    ]);
    const allPoles = [...makePoles(5, 'a'), ...makePoles(5, 'b')];
    // Everything dark except a1 (LIVE)
    const states = stateMap([
      ...allPoles.filter((id) => id !== 'a1').map((id) => [id, 'CONFIRMED_DARK']),
      ['a1', 'LIVE'],
    ]);
    const poles = poleMap(allPoles.map((id) => [id, true]));

    const { feederRollup } = evaluateFeederRollup('feeder-1', dtIds, dtPoleMap, states, poles);
    expect(feederRollup).toBeNull();
  });

  it('returns individual DT rollups even when feeder does not roll up', () => {
    const dtIds = ['dt-a', 'dt-b'];
    const dtPoleMap = new Map([
      ['dt-a', makePoles(10, 'a')], // 10 poles, all dark → DT_FAULT
      ['dt-b', makePoles(10, 'b')], // 5 dark, 5 not → no DT_FAULT
    ]);
    const aIds = makePoles(10, 'a');
    const bIds = makePoles(10, 'b');

    const states = stateMap([
      ...aIds.map((id) => [id, 'CONFIRMED_DARK']),        // DT-a: all dark
      ...bIds.slice(0, 5).map((id) => [id, 'CONFIRMED_DARK']), // DT-b: only 5 dark
    ]);
    const poles = poleMap([...aIds, ...bIds].map((id) => [id, true]));

    const { feederRollup, dtRollups } = evaluateFeederRollup('feeder-1', dtIds, dtPoleMap, states, poles);

    expect(feederRollup).toBeNull(); // 15/20 = 75% < 90%
    expect(dtRollups.get('dt-a')).not.toBeNull(); // dt-a did roll up
    expect(dtRollups.get('dt-b')).toBeNull();     // dt-b did not
  });
});

// ─── applyRollup ─────────────────────────────────────────────────────────────

describe('applyRollup', () => {
  function makeEdge(parentId, childId, dtId) {
    return { parent_pole_id: parentId, child_pole_id: childId, source: 'AUTHORITATIVE', ambiguous: false, _dtId: dtId };
  }

  function makePoleIdToDtId(edges) {
    return new Map(edges.map((e) => [e.child_pole_id, e._dtId]));
  }

  it('returns span frontier edges unchanged when no rollup fires', () => {
    const edges = [makeEdge('root', 'p1', 'dt-1')];
    const dtRollups = new Map([['dt-1', null]]);
    const poleIdToDtId = makePoleIdToDtId(edges);

    const { incidents, suppressedFrontierEdges } = applyRollup(edges, dtRollups, null, poleIdToDtId);

    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toBe(edges[0]);
    expect(suppressedFrontierEdges).toHaveLength(0);
  });

  it('suppresses span edges and replaces with DT_FAULT when DT rolls up', () => {
    const edges = [makeEdge('root', 'p1', 'dt-1'), makeEdge('root', 'p2', 'dt-1')];
    const dtRollupResult = { type: 'DT_FAULT', target_id: 'dt-1', affected_pole_ids: ['p1', 'p2'], dark_count: 2, monitored_count: 2, dark_ratio: 1.0, has_live_pole: false };
    const dtRollups = new Map([['dt-1', dtRollupResult]]);
    const poleIdToDtId = makePoleIdToDtId(edges);

    const { incidents, suppressedFrontierEdges } = applyRollup(edges, dtRollups, null, poleIdToDtId);

    expect(suppressedFrontierEdges).toHaveLength(2);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].type).toBe('DT_FAULT');
  });

  it('when FEEDER_FAULT: suppresses all span edges, returns feeder incident, nests DT incidents', () => {
    const edges = [makeEdge('root', 'p1', 'dt-a'), makeEdge('root', 'p2', 'dt-b')];
    const dtRollupA = { type: 'DT_FAULT', target_id: 'dt-a', affected_pole_ids: ['p1'], dark_count: 1, monitored_count: 1, dark_ratio: 1, has_live_pole: false };
    const dtRollupB = { type: 'DT_FAULT', target_id: 'dt-b', affected_pole_ids: ['p2'], dark_count: 1, monitored_count: 1, dark_ratio: 1, has_live_pole: false };
    const dtRollups = new Map([['dt-a', dtRollupA], ['dt-b', dtRollupB]]);
    const feederRollup = { type: 'FEEDER_FAULT', target_id: 'feeder-1', affected_pole_ids: ['p1', 'p2'], dark_count: 2, monitored_count: 2, dark_ratio: 1, has_live_pole: false };
    const poleIdToDtId = makePoleIdToDtId(edges);

    const { incidents, suppressedFrontierEdges, nestedDtIncidents } = applyRollup(edges, dtRollups, feederRollup, poleIdToDtId);

    expect(incidents).toHaveLength(1);
    expect(incidents[0].type).toBe('FEEDER_FAULT');
    expect(suppressedFrontierEdges).toHaveLength(2);
    expect(nestedDtIncidents).toHaveLength(2); // Both DT incidents kept as nested records
  });

  it('mixed: span edges from non-rolled-up DT are preserved alongside a DT_FAULT from another', () => {
    const edgeDt1 = makeEdge('rootA', 'pA1', 'dt-a');
    const edgeDt2 = makeEdge('rootB', 'pB1', 'dt-b');
    const dtRollupA = { type: 'DT_FAULT', target_id: 'dt-a', affected_pole_ids: ['pA1'], dark_count: 1, monitored_count: 1, dark_ratio: 1, has_live_pole: false };
    const dtRollups = new Map([['dt-a', dtRollupA], ['dt-b', null]]);
    const poleIdToDtId = new Map([['pA1', 'dt-a'], ['pB1', 'dt-b']]);

    const { incidents, suppressedFrontierEdges } = applyRollup([edgeDt1, edgeDt2], dtRollups, null, poleIdToDtId);

    expect(suppressedFrontierEdges).toHaveLength(1);    // pA1 edge suppressed
    expect(incidents).toHaveLength(2);                   // DT_FAULT for dt-a + span edge for dt-b
    expect(incidents.some((i) => i.type === 'DT_FAULT')).toBe(true);
    expect(incidents.some((i) => i.child_pole_id === 'pB1')).toBe(true);
  });
});
