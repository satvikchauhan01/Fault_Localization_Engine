import { describe, it, expect } from 'vitest';
import { selectPolesToConfirm, listeningStartAfter } from './sweeper.js';
import { DEBOUNCE_MS, HEARTBEAT_TIMEOUT_MS } from '../../../../packages/domain/src/thresholds.js';

const NOW = 10_000_000_000;
const MIN = 60 * 1000;

const livePole = (id, extra = {}) => ({
  pole_id: id,
  status: 'LIVE',
  candidate_dark_since: null,
  last_confirmed_at: new Date(NOW - 60 * MIN),
  evidence_summary: 'heartbeat (energized)',
  evidence_type: 'heartbeat_energized',
  ...extra,
});
const device = (poleId, lastSeenMsAgo, fw = '1.3.2') => [
  poleId,
  { id: `dev-${poleId}`, pole_id: poleId, fw_version: fw, last_seen: new Date(NOW - lastSeenMsAgo) },
];

describe('selectPolesToConfirm', () => {
  it('times out a device silent past the heartbeat timeout while we were listening', () => {
    const devices = new Map([device('p1', HEARTBEAT_TIMEOUT_MS + 5 * MIN)]);
    const listeningSince = NOW - 3 * HEARTBEAT_TIMEOUT_MS;

    const result = selectPolesToConfirm([livePole('p1')], devices, NOW, listeningSince);
    expect(result).toHaveLength(1);
    expect(result[0].newState.evidence_type).toBe('timeout_fw13');
  });

  it('does not count our own downtime as device silence', () => {
    // Device last heard 3 days ago, but this process only started 5 minutes ago.
    const devices = new Map([device('p1', 3 * 24 * 60 * MIN)]);
    const listeningSince = NOW - 5 * MIN;

    expect(selectPolesToConfirm([livePole('p1')], devices, NOW, listeningSince)).toHaveLength(0);
  });

  it('times out once the device stays silent for the full timeout after we started listening', () => {
    const devices = new Map([device('p1', 3 * 24 * 60 * MIN)]);
    const listeningSince = NOW - HEARTBEAT_TIMEOUT_MS - MIN;

    expect(selectPolesToConfirm([livePole('p1')], devices, NOW, listeningSince)).toHaveLength(1);
  });

  it('confirms an elapsed debounce regardless of when we started listening', () => {
    const pole = livePole('p1', { candidate_dark_since: new Date(NOW - DEBOUNCE_MS - 1000) });
    const devices = new Map([device('p1', 2 * MIN)]);

    const result = selectPolesToConfirm([pole], devices, NOW, NOW - MIN);
    expect(result).toHaveLength(1);
    expect(result[0].newState.status).toBe('CONFIRMED_DARK');
  });

  it('leaves a pole still inside its debounce alone', () => {
    const pole = livePole('p1', { candidate_dark_since: new Date(NOW - DEBOUNCE_MS + 5000) });
    const devices = new Map([device('p1', 2 * MIN)]);

    expect(selectPolesToConfirm([pole], devices, NOW, NOW - 60 * MIN)).toHaveLength(0);
  });
});

describe('listeningStartAfter', () => {
  const T = 1_000_000_000;

  it('keeps the window while sweeps run on schedule', () => {
    expect(listeningStartAfter(T - 60 * MIN, T - 5000, T)).toBe(T - 60 * MIN);
  });

  it('restarts the window after a gap where no sweep could run (host asleep)', () => {
    expect(listeningStartAfter(T - 5 * 60 * MIN, T - 3 * 60 * MIN, T)).toBe(T);
  });

  it('means a device silent only because the host slept is not timed out', () => {
    // Worker started 6 h ago; host slept for the last 3 h; device last heard 3 h ago.
    const devices = new Map([device('p1', 3 * 60 * MIN)]);
    const withoutGapDetection = NOW - 6 * 60 * MIN;
    const withGapDetection = listeningStartAfter(NOW - 6 * 60 * MIN, NOW - 3 * 60 * MIN, NOW);

    expect(selectPolesToConfirm([livePole('p1')], devices, NOW, withoutGapDetection)).toHaveLength(1);
    expect(selectPolesToConfirm([livePole('p1')], devices, NOW, withGapDetection)).toHaveLength(0);
  });
});
