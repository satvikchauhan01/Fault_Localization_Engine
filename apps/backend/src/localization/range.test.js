/**
 * @file range.test.js
 *
 * Step 17 — RANGE localization unit tests.
 *
 * Derived directly from Section G and Section H Rule 7 of the master plan.
 * Tests assert SPECIFICATION behavior, not implementation-internal behavior.
 * Any test failure is a signal to investigate the production code, not to weaken
 * the assertion.
 *
 * Key specification clauses exercised:
 *   Section G: "...bound it by the nearest monitored LIVE ancestor and nearest
 *               monitored DARK descendants"
 *   Section G: "...reported as RANGE, confidence capped at MEDIUM even under
 *               authoritative topology"
 *   Section H Rule 7: "Missing-device gap: if the frontier edge touches an
 *               unmonitored pole, expand to the bounded RANGE segment"
 *   Section I:  "RANGE spans more than N poles → LOW confidence"
 */

import { describe, it, expect } from 'vitest';
import { expandRangeIncident, buildRangeIncidents } from './range.js';
import { RANGE_LOW_CONFIDENCE_POLE_CUTOFF } from '../../../../packages/domain/src/thresholds.js';

// ─── Fixture Helpers ──────────────────────────────────────────────────────────

/**
 * Build poleMap. Each entry: [id, deviceId|null].
 * If deviceId is non-null, pole is monitored.
 */
function makePoleMap(entries) {
  return new Map(entries.map(([id, deviceId]) => [id, { device_id: deviceId }]));
}

/** Build poleStates from [id, status, evidence_type?] */
function makeStateMap(entries) {
  return new Map(
    entries.map(([id, status, evidence_type = 'power_lost']) => [id, { status, evidence_type }])
  );
}

/** Build childrenOf adjacency map from parent→child pairs */
function makeChildrenOf(pairs) {
  const map = new Map();
  for (const [parent, child] of pairs) {
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent).push(child);
  }
  return map;
}

/**
 * Build edgeMap. Each entry: [parentId, childId, source, ambiguous]
 * Key format matches frontier.js buildEdgeMap: `${parent}→${child}`
 */
function makeEdgeMap(entries) {
  const map = new Map();
  for (const [parent, child, source = 'AUTHORITATIVE', ambiguous = false] of entries) {
    map.set(`${parent}→${child}`, { parent_pole_id: parent, child_pole_id: child, source, ambiguous });
  }
  return map;
}

// ─── RANGE expansion tests ────────────────────────────────────────────────────

describe('expandRangeIncident — Section G/H Rule 7', () => {

  // ── Topology 1: Single unmonitored node between live parent and dark descendant ──
  //   P_live(monitored) → U_gap(unmonitored) → P_dark(monitored)
  //
  // rangeEdge: { parent: P_live, child: U_gap }  (frontier stopped at U_gap)
  // Expected:
  //   upstream_live_pole_id = 'P_live'   (nearest monitored LIVE ancestor)
  //   downstream_dark_pole_ids = ['P_dark']
  //   unmonitored_pole_ids = ['U_gap']
  //   gap_pole_count = 2 (1 unmonitored + 1 dark monitored endpoint)
  //   type = 'RANGE'
  describe('simple single-gap case: LIVE → unmonitored → DARK', () => {
    const rangeEdge = { parent_pole_id: 'P_live', child_pole_id: 'U_gap', missing_side: 'child' };
    const childrenOf = makeChildrenOf([['U_gap', 'P_dark']]);
    const poleStates = makeStateMap([
      ['P_live', 'LIVE'],
      ['P_dark', 'CONFIRMED_DARK'],
    ]);
    const poleMap = makePoleMap([
      ['P_live', 'dev-live'],   // monitored
      ['U_gap',  null],         // NOT monitored — the gap
      ['P_dark', 'dev-dark'],   // monitored
    ]);
    const edgeMap = makeEdgeMap([
      ['P_live', 'U_gap',  'AUTHORITATIVE', false],
      ['U_gap',  'P_dark', 'AUTHORITATIVE', false],
    ]);

    let result;
    it('produces type RANGE — not a fabricated exact-span edge (Section G)', () => {
      result = expandRangeIncident(rangeEdge, childrenOf, poleStates, poleMap, edgeMap);
      expect(result.type).toBe('RANGE');
    });

    it('identifies the monitored LIVE parent as upstream boundary (Section G)', () => {
      result = expandRangeIncident(rangeEdge, childrenOf, poleStates, poleMap, edgeMap);
      expect(result.upstream_live_pole_id).toBe('P_live');
    });

    it('identifies monitored DARK descendant as downstream boundary (Section G)', () => {
      result = expandRangeIncident(rangeEdge, childrenOf, poleStates, poleMap, edgeMap);
      expect(result.downstream_dark_pole_ids).toEqual(['P_dark']);
    });

    it('lists the unmonitored gap pole', () => {
      result = expandRangeIncident(rangeEdge, childrenOf, poleStates, poleMap, edgeMap);
      expect(result.unmonitored_pole_ids).toEqual(['U_gap']);
    });

    it('computes gap_pole_count = unmonitored + dark endpoint = 2', () => {
      result = expandRangeIncident(rangeEdge, childrenOf, poleStates, poleMap, edgeMap);
      // gap = U_gap (unmonitored, 1) + P_dark (monitored dark, 1) = 2
      expect(result.gap_pole_count).toBe(2);
    });

    it('low_confidence_by_size = false for a 2-pole gap (below cutoff of 10)', () => {
      result = expandRangeIncident(rangeEdge, childrenOf, poleStates, poleMap, edgeMap);
      expect(result.low_confidence_by_size).toBe(false);
      // Verify this is actually below the cutoff value from thresholds.js
      expect(result.gap_pole_count).toBeLessThanOrEqual(RANGE_LOW_CONFIDENCE_POLE_CUTOFF);
    });
  });

  // ── Topology 2: Unmonitored parent (upstream boundary is null) ───────────────
  //   DT_root → U_parent(unmonitored) → P_dark(monitored)
  //
  // rangeEdge: { parent: DT_root, child: U_parent, missing_side: 'child' }
  // The frontier parent itself is unmonitored — so upstream_live_pole_id = null
  describe('unmonitored parent → upstream boundary is null', () => {
    const rangeEdge = { parent_pole_id: 'DT_root', child_pole_id: 'U_parent', missing_side: 'child' };
    const childrenOf = makeChildrenOf([['U_parent', 'P_dark']]);
    const poleStates = makeStateMap([['P_dark', 'CONFIRMED_DARK']]);
    const poleMap = makePoleMap([
      ['DT_root', null],  // NOT monitored (DT itself is infrastructure, no device)
      ['U_parent', null], // NOT monitored
      ['P_dark', 'dev-dark'],
    ]);
    const edgeMap = makeEdgeMap([
      ['DT_root', 'U_parent', 'AUTHORITATIVE', false],
      ['U_parent', 'P_dark', 'AUTHORITATIVE', false],
    ]);

    it('upstream_live_pole_id is null when parent is unmonitored (Section G: cannot bound upstream)', () => {
      const result = expandRangeIncident(rangeEdge, childrenOf, poleStates, poleMap, edgeMap);
      expect(result.upstream_live_pole_id).toBeNull();
    });

    it('still correctly identifies downstream dark boundary even with null upstream', () => {
      const result = expandRangeIncident(rangeEdge, childrenOf, poleStates, poleMap, edgeMap);
      expect(result.downstream_dark_pole_ids).toEqual(['P_dark']);
    });
  });

  // ── Topology 3: AUTHORITATIVE topology source propagates correctly ──────────
  describe('AUTHORITATIVE topology source propagates', () => {
    const rangeEdge = { parent_pole_id: 'P_live', child_pole_id: 'U_gap', missing_side: 'child' };
    const childrenOf = makeChildrenOf([['U_gap', 'P_dark']]);
    const poleStates = makeStateMap([['P_live', 'LIVE'], ['P_dark', 'CONFIRMED_DARK']]);
    const poleMap = makePoleMap([['P_live', 'dev'], ['U_gap', null], ['P_dark', 'dev2']]);
    const edgeMap = makeEdgeMap([
      ['P_live', 'U_gap', 'AUTHORITATIVE', false],
      ['U_gap', 'P_dark', 'AUTHORITATIVE', false],
    ]);

    it('topology_source is AUTHORITATIVE when all gap edges are authoritative', () => {
      const result = expandRangeIncident(rangeEdge, childrenOf, poleStates, poleMap, edgeMap);
      expect(result.topology_source).toBe('AUTHORITATIVE');
      expect(result.ambiguous).toBe(false);
    });
  });

  // ── Topology 4: INFERRED edge inside gap → topology_source becomes INFERRED ──
  //   P_live → U_gap → P_dark   (the U_gap→P_dark edge is INFERRED)
  describe('INFERRED edge inside gap — topology_source propagates', () => {
    const rangeEdge = { parent_pole_id: 'P_live', child_pole_id: 'U_gap', missing_side: 'child' };
    const childrenOf = makeChildrenOf([['U_gap', 'P_dark']]);
    const poleStates = makeStateMap([['P_live', 'LIVE'], ['P_dark', 'CONFIRMED_DARK']]);
    const poleMap = makePoleMap([['P_live', 'dev'], ['U_gap', null], ['P_dark', 'dev2']]);
    // The edge ENTERING the gap from P_live is authoritative, but the edge within the gap is INFERRED
    const edgeMap = makeEdgeMap([
      ['P_live', 'U_gap', 'AUTHORITATIVE', false],
      ['U_gap',  'P_dark', 'INFERRED', false],
    ]);

    it('topology_source is INFERRED when any gap-internal edge is INFERRED', () => {
      const result = expandRangeIncident(rangeEdge, childrenOf, poleStates, poleMap, edgeMap);
      expect(result.topology_source).toBe('INFERRED');
    });

    it('ambiguous is false when the INFERRED edge is not flagged ambiguous', () => {
      const result = expandRangeIncident(rangeEdge, childrenOf, poleStates, poleMap, edgeMap);
      expect(result.ambiguous).toBe(false);
    });
  });

  // ── Topology 5: Ambiguous edge inside gap propagates ambiguous=true ──────────
  describe('Ambiguous edge inside gap — ambiguous flag propagates', () => {
    const rangeEdge = { parent_pole_id: 'P_live', child_pole_id: 'U_gap', missing_side: 'child' };
    const childrenOf = makeChildrenOf([['U_gap', 'P_dark']]);
    const poleStates = makeStateMap([['P_live', 'LIVE'], ['P_dark', 'CONFIRMED_DARK']]);
    const poleMap = makePoleMap([['P_live', 'dev'], ['U_gap', null], ['P_dark', 'dev2']]);
    const edgeMap = makeEdgeMap([
      ['P_live', 'U_gap', 'AUTHORITATIVE', false],
      ['U_gap',  'P_dark', 'INFERRED', true], // AMBIGUOUS
    ]);

    it('ambiguous is true when any gap-internal edge is ambiguous', () => {
      const result = expandRangeIncident(rangeEdge, childrenOf, poleStates, poleMap, edgeMap);
      expect(result.ambiguous).toBe(true);
    });
  });

  // ── Topology 6: Branching gap — one unmonitored with two dark children ───────
  //   P_live → U_gap → P_dark1
  //                  → P_dark2
  describe('branching gap — two downstream dark boundaries', () => {
    const rangeEdge = { parent_pole_id: 'P_live', child_pole_id: 'U_gap', missing_side: 'child' };
    const childrenOf = makeChildrenOf([['U_gap', 'P_dark1'], ['U_gap', 'P_dark2']]);
    const poleStates = makeStateMap([
      ['P_live', 'LIVE'],
      ['P_dark1', 'CONFIRMED_DARK'],
      ['P_dark2', 'CONFIRMED_DARK'],
    ]);
    const poleMap = makePoleMap([
      ['P_live', 'dev'], ['U_gap', null], ['P_dark1', 'dev1'], ['P_dark2', 'dev2'],
    ]);
    const edgeMap = makeEdgeMap([
      ['P_live', 'U_gap', 'AUTHORITATIVE', false],
      ['U_gap', 'P_dark1', 'AUTHORITATIVE', false],
      ['U_gap', 'P_dark2', 'AUTHORITATIVE', false],
    ]);

    it('identifies both dark monitored descendants as downstream boundaries', () => {
      const result = expandRangeIncident(rangeEdge, childrenOf, poleStates, poleMap, edgeMap);
      expect(result.downstream_dark_pole_ids).toHaveLength(2);
      expect(result.downstream_dark_pole_ids).toContain('P_dark1');
      expect(result.downstream_dark_pole_ids).toContain('P_dark2');
    });

    it('gap_pole_count includes both dark endpoints (1 unmonitored + 2 dark = 3)', () => {
      const result = expandRangeIncident(rangeEdge, childrenOf, poleStates, poleMap, edgeMap);
      expect(result.gap_pole_count).toBe(3);
    });
  });

  // ── Topology 7: No children of unmonitored — gap resolves to empty downstream ─
  //   P_live → U_leaf (leaf unmonitored, no children)
  describe('unmonitored leaf with no children', () => {
    const rangeEdge = { parent_pole_id: 'P_live', child_pole_id: 'U_leaf', missing_side: 'child' };
    const childrenOf = new Map(); // no children
    const poleStates = makeStateMap([['P_live', 'LIVE']]);
    const poleMap = makePoleMap([['P_live', 'dev'], ['U_leaf', null]]);
    const edgeMap = makeEdgeMap([['P_live', 'U_leaf', 'AUTHORITATIVE', false]]);

    it('produces a RANGE with empty downstream_dark_pole_ids when gap has no monitored dark descendants', () => {
      const result = expandRangeIncident(rangeEdge, childrenOf, poleStates, poleMap, edgeMap);
      expect(result.type).toBe('RANGE');
      expect(result.downstream_dark_pole_ids).toHaveLength(0);
      expect(result.unmonitored_pole_ids).toContain('U_leaf');
    });
  });

  // ── Topology 8: RANGE size threshold boundary tests ──────────────────────────
  //
  // RANGE_LOW_CONFIDENCE_POLE_CUTOFF = 10
  // A gap of exactly 10 poles → low_confidence_by_size = false (NOT low)
  // A gap of exactly 11 poles → low_confidence_by_size = true (LOW)
  describe('RANGE size threshold boundary (cutoff = RANGE_LOW_CONFIDENCE_POLE_CUTOFF)', () => {

    function makeLargeGapFixture(gapSize) {
      // P_live → U_1 → U_2 → ... → U_(gapSize-1) → P_dark
      // gap_pole_count = (gapSize-1) unmonitored + 1 dark monitored = gapSize
      const parent = 'P_live';
      const unmonitored = Array.from({ length: gapSize - 1 }, (_, i) => `U${i + 1}`);
      const darkPole = 'P_dark';

      const poleEntries = [
        [parent, 'dev-live'],
        ...unmonitored.map(id => [id, null]),
        [darkPole, 'dev-dark'],
      ];
      const stateEntries = [
        [parent, 'LIVE'],
        [darkPole, 'CONFIRMED_DARK'],
      ];
      const adjacencyPairs = [];
      const allNodes = [parent, ...unmonitored, darkPole];
      for (let i = 0; i < allNodes.length - 1; i++) {
        adjacencyPairs.push([allNodes[i], allNodes[i + 1]]);
      }

      // rangeEdge: parent → first unmonitored child (the detected gap start)
      const rangeEdge = { parent_pole_id: parent, child_pole_id: unmonitored[0], missing_side: 'child' };
      const childrenOf = makeChildrenOf(adjacencyPairs);
      const poleMap_ = makePoleMap(poleEntries);
      const poleStates_ = makeStateMap(stateEntries);
      const edgeMap_ = makeEdgeMap(adjacencyPairs.map(([p, c]) => [p, c, 'AUTHORITATIVE', false]));
      return { rangeEdge, childrenOf, poleMap_, poleStates_, edgeMap_, gapSize };
    }

    it('low_confidence_by_size = false when gap_pole_count == RANGE_LOW_CONFIDENCE_POLE_CUTOFF (exactly at boundary)', () => {
      const { rangeEdge, childrenOf, poleMap_, poleStates_, edgeMap_ } =
        makeLargeGapFixture(RANGE_LOW_CONFIDENCE_POLE_CUTOFF);
      const result = expandRangeIncident(rangeEdge, childrenOf, poleStates_, poleMap_, edgeMap_);
      expect(result.gap_pole_count).toBe(RANGE_LOW_CONFIDENCE_POLE_CUTOFF);
      expect(result.low_confidence_by_size).toBe(false); // exactly at cutoff → NOT low
    });

    it('low_confidence_by_size = true when gap_pole_count == RANGE_LOW_CONFIDENCE_POLE_CUTOFF + 1 (one over)', () => {
      const { rangeEdge, childrenOf, poleMap_, poleStates_, edgeMap_ } =
        makeLargeGapFixture(RANGE_LOW_CONFIDENCE_POLE_CUTOFF + 1);
      const result = expandRangeIncident(rangeEdge, childrenOf, poleStates_, poleMap_, edgeMap_);
      expect(result.gap_pole_count).toBe(RANGE_LOW_CONFIDENCE_POLE_CUTOFF + 1);
      expect(result.low_confidence_by_size).toBe(true); // one over → LOW
    });
  });

  // ── Topology 9: Multi-hop INFERRED gap (exposes range.js edge lookup bug) ────
  //   P_live → U1(unmonitored, auth edge) → U2(unmonitored, INFERRED edge) → P_dark
  //
  // SPECIFICATION BUG TEST: Section G requires that INFERRED topology propagates
  // from ANY edge in the gap. The current implementation uses the frontier's
  // parent_pole_id as the lookup prefix for ALL intermediate edges, which will
  // miss INFERRED edges on hops after the first unmonitored node.
  //
  // This test exercises multi-hop unmonitored chains. If the implementation is
  // correct, topology_source should be 'INFERRED'. If not, it will be 'AUTHORITATIVE'.
  describe('multi-hop unmonitored gap — intermediate INFERRED edge must propagate', () => {
    const rangeEdge = { parent_pole_id: 'P_live', child_pole_id: 'U1', missing_side: 'child' };
    const childrenOf = makeChildrenOf([['U1', 'U2'], ['U2', 'P_dark']]);
    const poleStates = makeStateMap([['P_live', 'LIVE'], ['P_dark', 'CONFIRMED_DARK']]);
    const poleMap = makePoleMap([
      ['P_live', 'dev'],
      ['U1', null],   // unmonitored
      ['U2', null],   // unmonitored
      ['P_dark', 'dev2'],
    ]);
    // U1→U2 edge is INFERRED (this is the intermediate hop)
    const edgeMap = makeEdgeMap([
      ['P_live', 'U1', 'AUTHORITATIVE', false],
      ['U1', 'U2', 'INFERRED', false], // intermediate INFERRED edge
      ['U2', 'P_dark', 'AUTHORITATIVE', false],
    ]);

    it('collects all unmonitored poles in a multi-hop gap', () => {
      const result = expandRangeIncident(rangeEdge, childrenOf, poleStates, poleMap, edgeMap);
      expect(result.unmonitored_pole_ids).toHaveLength(2);
      expect(result.unmonitored_pole_ids).toContain('U1');
      expect(result.unmonitored_pole_ids).toContain('U2');
    });

    it('topology_source = INFERRED when any intermediate hop is INFERRED (Section G)', () => {
      const result = expandRangeIncident(rangeEdge, childrenOf, poleStates, poleMap, edgeMap);
      // This test EXPOSES THE BUG in range.js: walkUnmonitored uses
      // `${parent_pole_id}→${nodeId}` (frontier parent prefix) rather than
      // the actual parent of each node. For U2, the lookup becomes 'P_live→U2',
      // which does NOT exist in edgeMap (the real key is 'U1→U2').
      // If this test fails, topology_source will be 'AUTHORITATIVE' incorrectly.
      expect(result.topology_source).toBe('INFERRED');
    });

    it('gap_pole_count includes both intermediate unmonitored poles + dark endpoint = 3', () => {
      const result = expandRangeIncident(rangeEdge, childrenOf, poleStates, poleMap, edgeMap);
      expect(result.gap_pole_count).toBe(3); // U1 + U2 + P_dark
    });
  });

  // ── buildRangeIncidents: batch expansion ─────────────────────────────────────
  describe('buildRangeIncidents — batch expansion', () => {
    it('maps multiple range edges to multiple RANGE incidents', () => {
      const edge1 = { parent_pole_id: 'A_live', child_pole_id: 'A_gap', missing_side: 'child' };
      const edge2 = { parent_pole_id: 'B_live', child_pole_id: 'B_gap', missing_side: 'child' };

      const childrenOf = makeChildrenOf([['A_gap', 'A_dark'], ['B_gap', 'B_dark']]);
      const poleStates = makeStateMap([
        ['A_live', 'LIVE'], ['A_dark', 'CONFIRMED_DARK'],
        ['B_live', 'LIVE'], ['B_dark', 'CONFIRMED_DARK'],
      ]);
      const poleMap_ = makePoleMap([
        ['A_live', 'dev1'], ['A_gap', null], ['A_dark', 'dev2'],
        ['B_live', 'dev3'], ['B_gap', null], ['B_dark', 'dev4'],
      ]);
      const edgeMap_ = makeEdgeMap([
        ['A_live', 'A_gap', 'AUTHORITATIVE', false],
        ['A_gap', 'A_dark', 'AUTHORITATIVE', false],
        ['B_live', 'B_gap', 'AUTHORITATIVE', false],
        ['B_gap', 'B_dark', 'AUTHORITATIVE', false],
      ]);

      const results = buildRangeIncidents([edge1, edge2], childrenOf, poleStates, poleMap_, edgeMap_);
      expect(results).toHaveLength(2);
      expect(results.every(r => r.type === 'RANGE')).toBe(true);
    });

    it('returns empty array when rangeEdges is empty', () => {
      const results = buildRangeIncidents([], new Map(), new Map(), new Map(), new Map());
      expect(results).toHaveLength(0);
    });
  });
});
