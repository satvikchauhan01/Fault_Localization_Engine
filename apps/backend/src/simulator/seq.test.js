import { describe, it, expect } from 'vitest';
import { nextSimulatorSeq } from './seq.js';

const INT32_MAX = 2_147_483_647;

describe('nextSimulatorSeq', () => {
  it('orders a later burst after an earlier one', () => {
    const earlier = nextSimulatorSeq(Date.UTC(2026, 8, 20, 12));
    const later = nextSimulatorSeq(Date.UTC(2026, 8, 27, 12));
    expect(later).toBeGreaterThan(earlier);
  });

  it('does not wrap where the old ms % 2e9 scheme reset to 0 (Oct 14 2026, 15:06 UTC)', () => {
    const wrapMs = 896 * 2_000_000_000;
    const beforeWrap = nextSimulatorSeq(wrapMs - 5 * 60 * 1000);
    const afterWrap = nextSimulatorSeq(wrapMs + 5 * 60 * 1000);
    expect(afterWrap - beforeWrap).toBe(6000);
  });

  it('stays strictly increasing for bursts inside the same tick', () => {
    const t = Date.UTC(2027, 0, 1);
    const a = nextSimulatorSeq(t);
    const b = nextSimulatorSeq(t);
    expect(b).toBeGreaterThan(a);
  });

  it('fits Postgres int32 through 2030', () => {
    expect(nextSimulatorSeq(Date.UTC(2030, 11, 31))).toBeLessThan(INT32_MAX);
  });
});
