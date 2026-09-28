import { PrismaClient } from '@prisma/client';
import { evaluateTimeout } from '../localization/pole-state.js';
import { runLocalizationForDt } from '../localization/orchestrator.js';
import { syncIncidents } from '../localization/incident-sync.js';
import { HEARTBEAT_TIMEOUT_MS } from '../../../../packages/domain/src/thresholds.js';

const prisma = new PrismaClient();

// Silence while this process was not running is our downtime, not the device's.
// Without this, restarting after a long stop, or the host waking from sleep,
// times out every device at once.
let listeningFrom = Date.now();
let lastSweepAt = Date.now();

// Sweeps run every 5 s; a gap this long means the process (or host) was frozen.
const FROZEN_GAP_MS = 2 * 60 * 1000;

const SWEEP_TX_TIMEOUT_MS = 30_000;

/** Pure: where the listening window starts after a sweep at `now`. */
export function listeningStartAfter(listeningFrom, lastSweepAt, now) {
  return now - lastSweepAt > FROZEN_GAP_MS ? now : listeningFrom;
}

function noteSweep(now) {
  listeningFrom = listeningStartAfter(listeningFrom, lastSweepAt, now);
  lastSweepAt = now;
  return listeningFrom;
}

/**
 * Pure: which candidate poles should become CONFIRMED_DARK now.
 *
 * @param {Iterable<object>} candidatePoles PoleState rows (LIVE)
 * @param {Map<string, object>} deviceByPole
 * @param {number} now
 * @param {number} listeningSince silence before this is not counted against a device
 * @returns {{ pole: object, newState: object }[]}
 */
export function selectPolesToConfirm(candidatePoles, deviceByPole, now, listeningSince) {
  const toConfirm = [];
  for (const pole of candidatePoles) {
    const device = deviceByPole.get(pole.pole_id);
    const effectiveDevice = device
      ? { ...device, last_seen: new Date(Math.max(new Date(device.last_seen).getTime(), listeningSince)) }
      : null;
    const newState = evaluateTimeout(pole, effectiveDevice, now);
    if (newState && newState.status === 'CONFIRMED_DARK') {
      toConfirm.push({ pole, newState });
    }
  }
  return toConfirm;
}

/**
 * Confirms poles whose debounce elapsed or whose device went silent past the
 * heartbeat timeout, then re-localizes each affected DT once.
 *
 * @param {{ now?: number, listeningSince?: number, db?: import('@prisma/client').PrismaClient }} [options]
 * @returns {Promise<string[]>} pole IDs transitioned to CONFIRMED_DARK
 */
export async function sweepTimeouts({ now = Date.now(), listeningSince = noteSweep(now), db = prisma } = {}) {
  const debouncingPoles = await db.poleState.findMany({
    where: { status: 'LIVE', candidate_dark_since: { not: null } },
  });

  const timeoutCutoff = now - HEARTBEAT_TIMEOUT_MS;
  const staleDevices = listeningSince < timeoutCutoff
    ? await db.device.findMany({
        where: { last_seen: { lt: new Date(timeoutCutoff) }, pole_id: { not: null } },
      })
    : [];
  const stalePoles = staleDevices.length > 0
    ? await db.poleState.findMany({
        where: { pole_id: { in: staleDevices.map((d) => d.pole_id) }, status: 'LIVE' },
      })
    : [];

  const candidates = new Map();
  for (const p of debouncingPoles) candidates.set(p.pole_id, p);
  for (const p of stalePoles) candidates.set(p.pole_id, p);
  if (candidates.size === 0) return [];

  const devices = await db.device.findMany({ where: { pole_id: { in: [...candidates.keys()] } } });
  const deviceByPole = new Map(devices.map((d) => [d.pole_id, d]));

  const toConfirm = selectPolesToConfirm(candidates.values(), deviceByPole, now, listeningSince);
  if (toConfirm.length === 0) return [];

  return db.$transaction(async (tx) => {
    const confirmedPoleIds = [];
    for (const { pole, newState } of toConfirm) {
      // Compare-and-set on what was read: a power_restored that landed in between wins.
      const { count } = await tx.poleState.updateMany({
        where: {
          pole_id: pole.pole_id,
          status: 'LIVE',
          candidate_dark_since: pole.candidate_dark_since,
        },
        data: {
          status: newState.status,
          candidate_dark_since: null,
          last_confirmed_at: new Date(newState.last_confirmed_at),
          evidence_summary: newState.evidence_summary,
          evidence_type: newState.evidence_type,
        },
      });
      if (count === 1) confirmedPoleIds.push(pole.pole_id);
    }
    if (confirmedPoleIds.length === 0) return [];

    // Every pole of a correlated burst is confirmed before anything is localized,
    // so the first DT evaluated already sees the whole picture (e.g. a full feeder).
    const confirmedPoles = await tx.pole.findMany({
      where: { id: { in: confirmedPoleIds } },
      select: { dt_id: true },
    });
    const dtIds = new Set(confirmedPoles.map((p) => p.dt_id).filter(Boolean));
    for (const dtId of dtIds) {
      const { incidents } = await runLocalizationForDt(dtId, tx);
      await syncIncidents(incidents, dtId, tx);
    }
    return confirmedPoleIds;
  }, { timeout: SWEEP_TX_TIMEOUT_MS, maxWait: SWEEP_TX_TIMEOUT_MS });
}
