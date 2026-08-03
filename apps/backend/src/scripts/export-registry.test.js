import { describe, it, expect } from 'vitest';
import { generateGroundTruthNetwork } from './generate-ground-truth.js';
import { exportRegistry, validateRegistryExport } from './export-registry.js';

const SEED = 42;

// Generate ground truth once and export once — shared across all tests
const groundTruth = generateGroundTruthNetwork({ seed: SEED });
const registry = exportRegistry(groundTruth);

// ── Helpers ───────────────────────────────────────────────────────────────────
const gtPoleById = new Map(groundTruth.poles.map((p) => [p.id, p]));
const regPoleById = new Map(registry.poles.map((p) => [p.id, p]));

describe('exportRegistry', () => {
  it('preserves pole count exactly', () => {
    expect(registry.poles.length).toBe(groundTruth.poles.length);
  });

  it('preserves feeder count exactly', () => {
    expect(registry.feeders.length).toBe(groundTruth.feeders.length);
  });

  it('preserves transformer count exactly', () => {
    expect(registry.transformers.length).toBe(groundTruth.transformers.length);
  });

  it('preserves device count exactly', () => {
    expect(registry.devices.length).toBe(groundTruth.devices.length);
  });

  // ── topology_source boundary ──────────────────────────────────────────────

  it('only uses RECORDED or MISSING as topology_source on transformers', () => {
    for (const dt of registry.transformers) {
      expect(['RECORDED', 'MISSING']).toContain(dt.topology_source);
      expect(dt.topology_source).not.toBe('INFERRED');
      expect(dt.topology_source).not.toBe('AUTHORITATIVE');
    }
  });

  // ── MISSING-topology DT poles: parent_pole_id and seq_on_line nulled ──────

  it('nulls parent_pole_id for all poles under MISSING-topology DTs', () => {
    const missingDtIds = new Set(
      registry.transformers.filter((dt) => dt.topology_source === 'MISSING').map((dt) => dt.id)
    );
    for (const p of registry.poles) {
      if (missingDtIds.has(p.dt_id)) {
        expect(p.parent_pole_id).toBeNull();
      }
    }
  });

  it('nulls seq_on_line for all poles under MISSING-topology DTs', () => {
    const missingDtIds = new Set(
      registry.transformers.filter((dt) => dt.topology_source === 'MISSING').map((dt) => dt.id)
    );
    for (const p of registry.poles) {
      if (missingDtIds.has(p.dt_id)) {
        expect(p.seq_on_line).toBeNull();
      }
    }
  });

  // ── RECORDED-topology DT poles: topology preserved ────────────────────────

  it('preserves parent_pole_id for non-root poles under RECORDED-topology DTs', () => {
    const recordedDtIds = new Set(
      registry.transformers.filter((dt) => dt.topology_source === 'RECORDED').map((dt) => dt.id)
    );
    const nonRootRegistryPoles = registry.poles.filter(
      (p) => recordedDtIds.has(p.dt_id) && p.parent_pole_id !== null
    );
    expect(nonRootRegistryPoles.length).toBeGreaterThan(0);

    for (const p of nonRootRegistryPoles) {
      const gtPole = gtPoleById.get(p.id);
      expect(p.parent_pole_id).toBe(gtPole.parent_pole_id);
    }
  });

  it('preserves seq_on_line for poles under RECORDED-topology DTs', () => {
    const recordedDtIds = new Set(
      registry.transformers.filter((dt) => dt.topology_source === 'RECORDED').map((dt) => dt.id)
    );
    for (const p of registry.poles) {
      if (recordedDtIds.has(p.dt_id)) {
        const gtPole = gtPoleById.get(p.id);
        expect(p.seq_on_line).toBe(gtPole.seq_on_line);
      }
    }
  });

  // ── No ground-truth-only information leaks for MISSING DTs ────────────────

  it('does not expose ground-truth parent_pole_id for any MISSING-topology pole', () => {
    const missingDtIds = new Set(
      registry.transformers.filter((dt) => dt.topology_source === 'MISSING').map((dt) => dt.id)
    );
    const missingPoles = registry.poles.filter((p) => missingDtIds.has(p.dt_id));
    expect(missingPoles.length).toBeGreaterThan(0);

    for (const regPole of missingPoles) {
      // Ground truth might have a non-null parent — verify registry has stripped it
      const gtPole = gtPoleById.get(regPole.id);
      if (gtPole.parent_pole_id !== null) {
        // The ground truth had a parent; registry must NOT expose it
        expect(regPole.parent_pole_id).toBeNull();
      }
    }
  });

  // ── No cross-DT parent references ─────────────────────────────────────────

  it('has no registry pole that references a parent in a different DT', () => {
    for (const p of registry.poles) {
      if (p.parent_pole_id !== null) {
        const parent = regPoleById.get(p.parent_pole_id);
        expect(parent).toBeDefined();
        expect(parent.dt_id).toBe(p.dt_id);
      }
    }
  });
});

describe('validateRegistryExport', () => {
  it('passes validation on a correctly exported registry', () => {
    const result = validateRegistryExport(groundTruth, registry);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('reports stats with correct structure', () => {
    const { stats } = validateRegistryExport(groundTruth, registry);
    expect(stats).toHaveProperty('totalDTs');
    expect(stats).toHaveProperty('missingDTs');
    expect(stats).toHaveProperty('recordedDTs');
    expect(stats).toHaveProperty('missingDTRatio');
    expect(stats).toHaveProperty('noDeviceRatio');
    expect(stats).toHaveProperty('fw12Ratio');
    expect(stats).toHaveProperty('missingPincodeRatio');
    // MISSING + RECORDED should add up to total
    expect(stats.missingDTs + stats.recordedDTs).toBe(stats.totalDTs);
  });

  it('detects a MISSING-topology pole that still has a parent_pole_id', () => {
    const missingDtId = registry.transformers.find((dt) => dt.topology_source === 'MISSING')?.id;
    expect(missingDtId).toBeDefined();

    // Inject bad data: manually put a parent back for one MISSING pole
    const corruptedRegistry = {
      ...registry,
      poles: registry.poles.map((p) => {
        if (p.dt_id === missingDtId && p.pincode) {
          // tamper with exactly one pole
          return { ...p, parent_pole_id: 'pole-tampered' };
        }
        return p;
      }),
    };

    const result = validateRegistryExport(groundTruth, corruptedRegistry);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('still has parent_pole_id'))).toBe(true);
  });

  it('detects a MISSING-topology pole that still has seq_on_line', () => {
    const missingDtId = registry.transformers.find((dt) => dt.topology_source === 'MISSING')?.id;
    const corruptedRegistry = {
      ...registry,
      poles: registry.poles.map((p) => {
        if (p.dt_id === missingDtId && p.pincode) {
          return { ...p, seq_on_line: 3 };
        }
        return p;
      }),
    };

    const result = validateRegistryExport(groundTruth, corruptedRegistry);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('still has seq_on_line'))).toBe(true);
  });

  it('detects a cross-DT parent reference', () => {
    const firstDtId = registry.transformers[0]?.id;
    const secondDtId = registry.transformers[registry.transformers.length - 1]?.id;
    // Pick a non-root pole from firstDt and have it reference a pole from secondDt
    const firstDtPoles = registry.poles.filter((p) => p.dt_id === firstDtId);
    const secondDtPoles = registry.poles.filter((p) => p.dt_id === secondDtId);

    if (firstDtPoles.length >= 2 && secondDtPoles.length >= 1) {
      const corruptedRegistry = {
        ...registry,
        poles: registry.poles.map((p) => {
          if (p.id === firstDtPoles[1].id) {
            return { ...p, parent_pole_id: secondDtPoles[0].id };
          }
          return p;
        }),
      };
      const result = validateRegistryExport(groundTruth, corruptedRegistry);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('different DT'))).toBe(true);
    }
  });
});
