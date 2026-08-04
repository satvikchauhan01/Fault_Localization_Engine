import { SCHEDULED_OUTAGE_OVERRUN_BUFFER_MS } from '../../../../packages/domain/src/thresholds.js';
import { ScheduledOutageSchema } from '../../../../packages/domain/src/schemas.js';

/**
 * Fetches scheduled outages from a remote feed or raw data array and upserts into local DB cache.
 * 
 * @param {string|Array<object>} feedUrlOrData URL to fetch feed from, or raw array of outage entries
 * @param {import('@prisma/client').PrismaClient} prisma Prisma client instance
 * @returns {Promise<number>} Number of cached outage records
 */
export async function fetchAndCacheScheduledOutages(feedUrlOrData, prisma) {
  let entries = [];

  if (typeof feedUrlOrData === 'string') {
    const res = await fetch(feedUrlOrData);
    if (!res.ok) {
      throw new Error(`Failed to fetch scheduled outages feed: ${res.statusText}`);
    }
    entries = await res.json();
  } else if (Array.isArray(feedUrlOrData)) {
    entries = feedUrlOrData;
  } else {
    throw new Error('Invalid feed URL or data provided to fetchAndCacheScheduledOutages');
  }

  const now = new Date();
  let count = 0;

  for (const item of entries) {
    const parsed = ScheduledOutageSchema.partial({ fetched_at: true }).safeParse({
      ...item,
      fetched_at: item.fetched_at || now.toISOString(),
    });

    if (!parsed.success) {
      console.warn('[ScheduledOutageAdapter] Skipping invalid outage item:', parsed.error);
      continue;
    }

    const data = parsed.data;

    await prisma.scheduledOutage.upsert({
      where: { id: data.id },
      update: {
        scope: data.scope,
        target_id: data.target_id,
        start: new Date(data.start),
        end: new Date(data.end),
        reason: data.reason,
        fetched_at: now,
      },
      create: {
        id: data.id,
        scope: data.scope,
        target_id: data.target_id,
        start: new Date(data.start),
        end: new Date(data.end),
        reason: data.reason,
        fetched_at: now,
      },
    });

    count++;
  }

  return count;
}

/**
 * Checks whether an incident candidate overlaps with any active or overrun-buffered scheduled outage.
 * 
 * Rules:
 * 1. Time overlap: start <= incidentTime <= (end + 40 mins overrun buffer)
 * 2. Scope & Target match:
 *    - scope == 'DT' and target_id == dtId
 *    - scope == 'FEEDER' and target_id == feederId
 *    - scope == 'SPAN' and target_id in affectedPoleIds
 * 
 * @param {object} params
 * @param {string} [params.dtId]
 * @param {string} [params.feederId]
 * @param {string[]} [params.affectedPoleIds]
 * @param {Date|number} [params.incidentTime]
 * @param {import('@prisma/client').PrismaClient} tx Prisma client or transaction instance
 * @returns {Promise<boolean>} True if an overlapping scheduled outage exists
 */
export async function checkScheduledOutageOverlap({ dtId, feederId, affectedPoleIds = [], incidentTime = new Date() }, tx) {
  const targetIds = Array.from(new Set([dtId, feederId, ...affectedPoleIds].filter(Boolean)));
  if (targetIds.length === 0) return false;

  const outages = await tx.scheduledOutage.findMany({
    where: {
      target_id: { in: targetIds },
    },
  });

  if (outages.length === 0) return false;

  const incTimeMs = typeof incidentTime === 'number' ? incidentTime : new Date(incidentTime).getTime();

  for (const outage of outages) {
    const startMs = outage.start.getTime();
    const endWithBufferMs = outage.end.getTime() + SCHEDULED_OUTAGE_OVERRUN_BUFFER_MS;

    if (incTimeMs >= startMs && incTimeMs <= endWithBufferMs) {
      if (outage.scope === 'DT' && dtId && outage.target_id === dtId) {
        return true;
      }
      if (outage.scope === 'FEEDER' && feederId && outage.target_id === feederId) {
        return true;
      }
      if (outage.scope === 'SPAN' && affectedPoleIds.includes(outage.target_id)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Starts periodic background polling of a scheduled outages feed URL.
 * 
 * @param {string} feedUrl 
 * @param {number} intervalMs 
 * @param {import('@prisma/client').PrismaClient} prisma 
 * @returns {{ stop: () => void }}
 */
export function startPollingScheduledOutages(feedUrl, intervalMs = 60_000, prisma) {
  let timerId = null;

  const poll = async () => {
    try {
      await fetchAndCacheScheduledOutages(feedUrl, prisma);
    } catch (err) {
      console.error('[ScheduledOutageAdapter] Error during periodic polling:', err);
    }
  };

  poll();
  timerId = setInterval(poll, intervalMs);

  return {
    stop: () => {
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
    },
  };
}
