import { describe, it, expect } from 'vitest';
import {
  generateGroundTruthNetwork,
  validateTreeStructure,
  seededRandom,
} from './generate-ground-truth.js';

// Use a fixed seed so all tests are deterministic and non-flaky
const SEED = 42;

describe('seededRandom', () => {
  it('produces values in [0, 1)', () => {
    const rand = seededRandom(SEED);
    for (let i = 0; i < 1000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is fully reproducible given the same seed', () => {
    const r1 = seededRandom(SEED);
    const r2 = seededRandom(SEED);
    for (let i = 0; i < 20; i++) {
      expect(r1()).toBe(r2());
    }
  });
});

describe('generateGroundTruthNetwork', () => {
  const network = generateGroundTruthNetwork({ seed: SEED });

  it('produces element counts within spec bounds', () => {
    expect(network.feeders.length).toBeGreaterThanOrEqual(4);
    expect(network.feeders.length).toBeLessThanOrEqual(6);

    expect(network.transformers.length).toBeGreaterThanOrEqual(30);
    expect(network.transformers.length).toBeLessThanOrEqual(40);

    expect(network.poles.length).toBeGreaterThanOrEqual(3000);
    expect(network.poles.length).toBeLessThanOrEqual(5000);
  });

  it('uses only RECORDED or MISSING as topology_source — never INFERRED', () => {
    for (const dt of network.transformers) {
      expect(['RECORDED', 'MISSING']).toContain(dt.topology_source);
      expect(dt.topology_source).not.toBe('INFERRED');
      expect(dt.topology_source).not.toBe('AUTHORITATIVE');
    }
  });

  it('meets the ~40% RECORDED topology ratio', () => {
    const recorded = network.transformers.filter((t) => t.topology_source === 'RECORDED').length;
    const ratio = recorded / network.transformers.length;
    expect(ratio).toBeGreaterThan(0.30);
    expect(ratio).toBeLessThan(0.50);
  });

  it('meets the ~9% no-device ratio', () => {
    const unmonitored = network.poles.filter((p) => p.device_id === null).length;
    const ratio = unmonitored / network.poles.length;
    expect(ratio).toBeGreaterThan(0.05);
    expect(ratio).toBeLessThan(0.15);
  });

  it('meets the ~8% fw<1.3 device ratio', () => {
    const fw12 = network.devices.filter((d) => d.fw_version.startsWith('1.2')).length;
    const ratio = fw12 / network.devices.length;
    expect(ratio).toBeGreaterThan(0.04);
    expect(ratio).toBeLessThan(0.13);
  });

  it('meets the ~3% missing pincode ratio', () => {
    const missing = network.poles.filter((p) => p.pincode === null).length;
    const ratio = missing / network.poles.length;
    expect(ratio).toBeGreaterThan(0.01);
    expect(ratio).toBeLessThan(0.06);
  });

  it('all DTs are assigned to a known feeder', () => {
    const feederIds = new Set(network.feeders.map((f) => f.id));
    for (const dt of network.transformers) {
      expect(feederIds.has(dt.feeder_id)).toBe(true);
    }
  });

  it('all poles have GPS coordinates within plausible range of Bangalore', () => {
    for (const p of network.poles) {
      expect(p.lat).toBeGreaterThan(12.0);
      expect(p.lat).toBeLessThan(14.0);
      expect(p.lon).toBeGreaterThan(77.0);
      expect(p.lon).toBeLessThan(79.0);
    }
  });
});

describe('validateTreeStructure', () => {
  it('passes on a correctly generated network', () => {
    const network = generateGroundTruthNetwork({ seed: SEED });
    const result = validateTreeStructure(network);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('detects a self-referencing pole', () => {
    const network = generateGroundTruthNetwork({ seed: SEED, feederCount: 1, dtCount: 1, targetPoleCount: 10 });
    // Inject a self-parent
    network.poles[1].parent_pole_id = network.poles[1].id;
    const result = validateTreeStructure(network);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('self-reference'))).toBe(true);
  });

  it('detects a cross-DT parent reference', () => {
    const network = generateGroundTruthNetwork({ seed: SEED, feederCount: 2, dtCount: 2, targetPoleCount: 20 });
    const dt0Poles = network.poles.filter((p) => p.dt_id === 'dt-1');
    const dt1Poles = network.poles.filter((p) => p.dt_id === 'dt-2');
    if (dt0Poles.length >= 2 && dt1Poles.length >= 1) {
      // Force a non-root pole of dt-1 to point at a pole in dt-2
      dt0Poles[1].parent_pole_id = dt1Poles[0].id;
      const result = validateTreeStructure(network);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('belongs to DT'))).toBe(true);
    }
  });

  it('detects a nonexistent parent ID', () => {
    const network = generateGroundTruthNetwork({ seed: SEED, feederCount: 1, dtCount: 1, targetPoleCount: 10 });
    network.poles[1].parent_pole_id = 'pole-NONEXISTENT';
    const result = validateTreeStructure(network);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-existent parent'))).toBe(true);
  });

  it('detects a duplicate pole ID', () => {
    const network = generateGroundTruthNetwork({ seed: SEED, feederCount: 1, dtCount: 1, targetPoleCount: 10 });
    const dup = { ...network.poles[2], id: network.poles[0].id };
    network.poles.push(dup);
    const result = validateTreeStructure(network);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Duplicate'))).toBe(true);
  });

  it('detects orphan poles not reachable from root', () => {
    const network = generateGroundTruthNetwork({ seed: SEED, feederCount: 1, dtCount: 1, targetPoleCount: 10 });
    // Introduce a disconnected pole by using a parent that doesn't link to root
    const orphan = {
      id: 'pole-orphan-99',
      dt_id: network.transformers[0].id,
      feeder_id: network.transformers[0].feeder_id,
      lat: 12.9,
      lon: 77.5,
      seq_on_line: 5,
      parent_pole_id: null, // second root — breaks single-root rule
      ward: 'Ward 1',
      pincode: '560001',
      device_id: null,
    };
    network.poles.push(orphan);
    const result = validateTreeStructure(network);
    expect(result.valid).toBe(false);
  });
});

describe('generateGroundTruthNetwork — physical layout', () => {
  const network = generateGroundTruthNetwork({ seed: SEED });
  const metres = (a, b) => {
    const dLat = (a.lat - b.lat) * 111000;
    const dLon = (a.lon - b.lon) * 111000 * Math.cos((a.lat * Math.PI) / 180);
    return Math.hypot(dLat, dLon);
  };
  const asPoint = ([lat, lon]) => ({ lat, lon });

  it('runs every feeder from the substation through its DTs in order', () => {
    const substation = network.feeders[0].route[0];
    for (const feeder of network.feeders) {
      expect(feeder.substation).toBeTruthy();
      expect(feeder.route[0]).toEqual(substation);
      const dts = network.transformers.filter((dt) => dt.feeder_id === feeder.id);
      dts.forEach((dt, k) => {
        expect(feeder.route[k + 1]).toEqual([dt.lat, dt.lon]);
      });
    }
  });

  it('keeps every LT span at a realistic pole-to-pole length', () => {
    const byId = new Map(network.poles.map((p) => [p.id, p]));
    for (const p of network.poles) {
      if (!p.parent_pole_id) continue;
      const span = metres(p, byId.get(p.parent_pole_id));
      expect(span).toBeGreaterThan(25);
      expect(span).toBeLessThan(52);
    }
  });

  it('puts each DT root pole right beside its transformer', () => {
    const dtById = new Map(network.transformers.map((dt) => [dt.id, dt]));
    for (const root of network.poles.filter((p) => p.parent_pole_id === null)) {
      expect(metres(root, dtById.get(root.dt_id))).toBeLessThan(30);
    }
  });

  it('never lets two DTs\' LT networks overlap', () => {
    const cellM = 20;
    const cells = new Map();
    for (const p of network.poles) {
      const key = `${Math.floor(p.lat * 111000 / cellM)}:${Math.floor(p.lon * 108000 / cellM)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(p);
    }
    for (const p of network.poles) {
      const cx = Math.floor(p.lat * 111000 / cellM);
      const cy = Math.floor(p.lon * 108000 / cellM);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const q of cells.get(`${cx + dx}:${cy + dy}`) || []) {
            if (q.dt_id !== p.dt_id) expect(metres(p, q)).toBeGreaterThanOrEqual(19);
          }
        }
      }
    }
  });

  it('places DTs along their feeder at realistic spacing', () => {
    for (const feeder of network.feeders) {
      const taps = feeder.route.slice(1, -1).map(asPoint);
      for (let k = 1; k < taps.length; k++) {
        const gap = metres(taps[k - 1], taps[k]);
        expect(gap).toBeGreaterThan(600);
        expect(gap).toBeLessThan(800);
      }
    }
  });
});
