import { describe, it, expect } from 'vitest';
import {
  buildAuthoritativeTree,
  buildAllAuthoritativeTrees,
} from './authoritative.js';

// ─── Fixture helpers ────────────────────────────────────────────────────────

/** Build a minimal pole object. `parentId` null = root. */
function makePole(id, parentId, seq, lat = 12.9716, lon = 77.5946) {
  return {
    id,
    dt_id: 'dt-1',
    feeder_id: 'feeder-1',
    lat,
    lon,
    seq_on_line: seq,
    parent_pole_id: parentId,
    device_id: `dev-${id}`,
    pincode: '560001',
  };
}

/** Build a linear chain: root → p1 → p2 → … → pN */
function linearChain(length) {
  const poles = [];
  poles.push(makePole('root', null, 1, 12.9716, 77.5946));
  for (let i = 1; i < length; i++) {
    const parentId = i === 1 ? 'root' : `p${i - 1}`;
    // Advance ~30 m north per step
    poles.push(makePole(`p${i}`, parentId, i + 1, 12.9716 + i * 0.00027, 77.5946));
  }
  return poles;
}

// ─── buildAuthoritativeTree ─────────────────────────────────────────────────

describe('buildAuthoritativeTree — happy path', () => {
  it('builds correct edges for a 3-pole linear chain', () => {
    // root → p1 → p2
    const poles = [
      makePole('root', null, 1, 12.9716, 77.5946),
      makePole('p1', 'root', 2, 12.9719, 77.5946),
      makePole('p2', 'p1', 3, 12.9722, 77.5946),
    ];

    const result = buildAuthoritativeTree(poles, 'dt-1');

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.edges).toHaveLength(2); // 3 poles → 2 edges
  });

  it('all edges are tagged AUTHORITATIVE', () => {
    const poles = linearChain(5);
    const { edges } = buildAuthoritativeTree(poles, 'dt-1');
    for (const e of edges) {
      expect(e.source).toBe('AUTHORITATIVE');
    }
  });

  it('all edges have ambiguous: false', () => {
    const poles = linearChain(5);
    const { edges } = buildAuthoritativeTree(poles, 'dt-1');
    for (const e of edges) {
      expect(e.ambiguous).toBe(false);
    }
  });

  it('edge parent/child IDs are correct for a linear chain', () => {
    const poles = [
      makePole('root', null, 1),
      makePole('p1', 'root', 2),
      makePole('p2', 'p1', 3),
    ];
    const { edges } = buildAuthoritativeTree(poles, 'dt-1');
    const pairs = edges.map((e) => `${e.parent_pole_id}→${e.child_pole_id}`);
    expect(pairs).toContain('root→p1');
    expect(pairs).toContain('p1→p2');
  });

  it('computes a positive haversine weight for every edge', () => {
    const poles = [
      makePole('root', null, 1, 12.9716, 77.5946),
      makePole('p1', 'root', 2, 12.9749, 77.5946), // ~366 m north
    ];
    const { edges } = buildAuthoritativeTree(poles, 'dt-1');
    expect(edges[0].weight).toBeGreaterThan(0);
  });

  it('handles a branched tree (one root, two children)', () => {
    const poles = [
      makePole('root', null, 1, 12.9716, 77.5946),
      makePole('a', 'root', 2, 12.9749, 77.5946),
      makePole('b', 'root', 2, 12.9716, 77.5979),
      makePole('c', 'a', 3, 12.9782, 77.5946),
    ];
    const result = buildAuthoritativeTree(poles, 'dt-1');
    expect(result.valid).toBe(true);
    expect(result.edges).toHaveLength(3); // 4 poles → 3 edges
  });

  it('produces no edges for a single root-only DT', () => {
    const poles = [makePole('root', null, 1)];
    const result = buildAuthoritativeTree(poles, 'dt-1');
    expect(result.valid).toBe(true);
    expect(result.edges).toHaveLength(0);
  });
});

describe('buildAuthoritativeTree — seq_on_line warnings', () => {
  it('warns when child seq ≠ parent seq + 1 (gap)', () => {
    const poles = [
      makePole('root', null, 1),
      makePole('p1', 'root', 3), // gap: expected 2, got 3
    ];
    const result = buildAuthoritativeTree(poles, 'dt-1');
    expect(result.valid).toBe(true); // warning, not error
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/seq_on_line gap/);
  });

  it('does not warn when seq_on_line is null on either side', () => {
    const poles = [
      makePole('root', null, null),
      makePole('p1', 'root', null),
    ];
    const result = buildAuthoritativeTree(poles, 'dt-1');
    expect(result.warnings).toHaveLength(0);
  });

  it('does not warn when seq is correct', () => {
    const poles = linearChain(4);
    const result = buildAuthoritativeTree(poles, 'dt-1');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('buildAuthoritativeTree — error cases', () => {
  it('errors on empty pole array', () => {
    const result = buildAuthoritativeTree([], 'dt-1');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('errors when no root pole exists (everyone has a parent)', () => {
    const poles = [
      makePole('p1', 'p2', 1),
      makePole('p2', 'p1', 2),
    ];
    const result = buildAuthoritativeTree(poles, 'dt-1');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-existent parent') || e.includes('no root'))).toBe(true);
  });

  it('errors when multiple root poles exist', () => {
    const poles = [
      makePole('root1', null, 1),
      makePole('root2', null, 1),
      makePole('child', 'root1', 2),
    ];
    const result = buildAuthoritativeTree(poles, 'dt-1');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('multiple root'))).toBe(true);
  });

  it('errors when a pole references a non-existent parent', () => {
    const poles = [
      makePole('root', null, 1),
      makePole('p1', 'GHOST-999', 2),
    ];
    const result = buildAuthoritativeTree(poles, 'dt-1');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-existent parent'))).toBe(true);
  });

  it('errors on duplicate pole IDs', () => {
    const poles = [
      makePole('root', null, 1),
      makePole('root', null, 1), // duplicate
    ];
    const result = buildAuthoritativeTree(poles, 'dt-1');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Duplicate'))).toBe(true);
  });

  it('errors when poles belong to a different DT', () => {
    const poles = [{ ...makePole('root', null, 1), dt_id: 'dt-OTHER' }];
    const result = buildAuthoritativeTree(poles, 'dt-1');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('belongs to DT'))).toBe(true);
  });
});

// ─── buildAllAuthoritativeTrees ─────────────────────────────────────────────

describe('buildAllAuthoritativeTrees', () => {
  function makeTransformer(id, source) {
    return { id, topology_source: source, feeder_id: 'feeder-1', lat: 12.97, lon: 77.59, capacity_kva: 250, households_served: 50 };
  }

  it('processes only RECORDED DTs and skips MISSING ones', () => {
    const transformers = [
      makeTransformer('dt-1', 'RECORDED'),
      makeTransformer('dt-2', 'MISSING'),
    ];
    const poles = [
      makePole('r1', null, 1),                        // dt-1 root
      { ...makePole('c1', 'r1', 2), dt_id: 'dt-1' }, // dt-1 child
      { id: 'r2', dt_id: 'dt-2', feeder_id: 'feeder-1', lat: 12.97, lon: 77.60, seq_on_line: null, parent_pole_id: null, device_id: null, pincode: null },
    ];
    // Fix dt_id on dt-1 poles
    poles[0].dt_id = 'dt-1';
    poles[1].dt_id = 'dt-1';

    const { edges, dtResults } = buildAllAuthoritativeTrees(transformers, poles);

    expect(dtResults.has('dt-1')).toBe(true);
    expect(dtResults.has('dt-2')).toBe(false); // MISSING — skipped
    expect(edges.length).toBe(1); // one edge from dt-1
    expect(edges[0].source).toBe('AUTHORITATIVE');
  });

  it('aggregates edges from multiple RECORDED DTs', () => {
    const transformers = [
      makeTransformer('dt-a', 'RECORDED'),
      makeTransformer('dt-b', 'RECORDED'),
    ];
    const polesA = [
      { ...makePole('ra', null, 1), dt_id: 'dt-a' },
      { ...makePole('ca', 'ra', 2), dt_id: 'dt-a' },
    ];
    const polesB = [
      { ...makePole('rb', null, 1), dt_id: 'dt-b' },
      { ...makePole('cb', 'rb', 2), dt_id: 'dt-b' },
      { ...makePole('cb2', 'rb', 2), dt_id: 'dt-b' },
    ];

    const { edges } = buildAllAuthoritativeTrees(transformers, [...polesA, ...polesB]);
    // dt-a: 1 edge, dt-b: 2 edges
    expect(edges).toHaveLength(3);
    expect(edges.every((e) => e.source === 'AUTHORITATIVE')).toBe(true);
  });

  it('does not emit edges for an invalid DT (cycles/orphans)', () => {
    const transformers = [makeTransformer('dt-bad', 'RECORDED')];
    // No root pole → tree build will fail
    const poles = [
      { ...makePole('p1', 'p2', 1), dt_id: 'dt-bad' },
      { ...makePole('p2', 'p1', 2), dt_id: 'dt-bad' },
    ];
    const { edges, dtResults } = buildAllAuthoritativeTrees(transformers, poles);
    expect(edges).toHaveLength(0);
    expect(dtResults.get('dt-bad').valid).toBe(false);
  });
});

// ─── Integration: use registry export + authoritative builder together ───────

describe('integration: export-registry → buildAllAuthoritativeTrees', () => {
  it('successfully builds trees for all RECORDED DTs in a generated network', async () => {
    const { generateGroundTruthNetwork } = await import('../scripts/generate-ground-truth.js');
    const { exportRegistry } = await import('../scripts/export-registry.js');

    const network = generateGroundTruthNetwork({ seed: 99 });
    const registry = exportRegistry(network);

    const { edges, dtResults } = buildAllAuthoritativeTrees(
      registry.transformers,
      registry.poles
    );

    // All RECORDED DTs must produce valid trees
    for (const [dtId, result] of dtResults) {
      expect(result.valid, `DT ${dtId} should be valid: ${result.errors.join('; ')}`).toBe(true);
    }

    // Every edge must be AUTHORITATIVE with a positive weight
    for (const e of edges) {
      expect(e.source).toBe('AUTHORITATIVE');
      expect(e.weight).toBeGreaterThan(0);
      expect(e.ambiguous).toBe(false);
    }

    // Should have processed only RECORDED DTs
    const recordedDts = registry.transformers.filter((dt) => dt.topology_source === 'RECORDED');
    expect(dtResults.size).toBe(recordedDts.length);
  });
});
