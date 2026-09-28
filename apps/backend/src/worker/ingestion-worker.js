import { PrismaClient } from '@prisma/client';
import { runLocalizationForDt } from '../localization/orchestrator.js';
import { syncIncidents } from '../localization/incident-sync.js';

const prisma = new PrismaClient();

// DTs where a pole regained supply since the last pass. Re-localized once per
// pass instead of once per event, so a feeder repair or the heartbeat round
// after a mass outage (thousands of LIVE transitions) doesn't swamp the worker.
const restoredDts = new Set();

/**
 * Re-localizes every DT marked by a restore since the last call, so incidents
 * refine to whatever is still dark (e.g. a second break further down).
 */
export async function relocalizeRestoredDts(db = prisma) {
  const dtIds = [...restoredDts];
  restoredDts.clear();
  for (const dtId of dtIds) {
    await db.$transaction(async (tx) => {
      const { incidents } = await runLocalizationForDt(dtId, tx);
      await syncIncidents(incidents, dtId, tx);
    }, { timeout: 30_000, maxWait: 30_000 });
  }
  return dtIds;
}

/**
 * Polls the telemetry_inbox for a single pending event, processes it,
 * and updates the pole_state + triggers localization inside a single transaction.
 * 
 * @returns {Promise<boolean>} True if an event was processed, false if inbox is empty.
 */
export async function processNextTelemetryEvent() {
  // 1. Claim a row exclusively using FOR UPDATE SKIP LOCKED.
  // This requires a raw query in Prisma.
  return await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT id 
      FROM telemetry_inbox 
      WHERE status = 'PENDING' 
      ORDER BY 
        CASE 
          WHEN event = 'power_lost' THEN 0 
          WHEN event = 'power_restored' THEN 1 
          ELSE 2 
        END ASC,
        server_received_at ASC
      LIMIT 1 
      FOR UPDATE SKIP LOCKED
    `;

    if (rows.length === 0) {
      return false; // Queue is empty or all pending rows are locked
    }

    const rowId = rows[0].id;

    // 2. Fetch the full row (now securely locked by our transaction)
    const eventRecord = await tx.telemetryInbox.findUnique({ where: { id: rowId } });

    try {
      // 3. Process the event against PoleState
      const currentState = await tx.poleState.findUnique({ where: { pole_id: eventRecord.pole_id } });

      const eventObj = {
        event: eventRecord.event,
        energized: eventRecord.energized,
        seq: eventRecord.seq,
        server_received_at: eventRecord.server_received_at.getTime()
      };

      const { processEvent, evaluateTimeout } = await import('../localization/pole-state.js');

      let newState = processEvent(currentState, eventObj);

      // Resolve the debounce inline if this event is already old enough. The
      // heartbeat-timeout rule is left to the sweeper (no device passed): an event
      // proves liveness at server_received_at, and one that sat in the inbox
      // backlog past the timeout would otherwise darken a healthy pole.
      const now = new Date().getTime();
      const timedOutState = evaluateTimeout(newState, null, now);
      if (timedOutState) {
        newState = timedOutState;
      }

      // 4. Upsert the PoleState if it changed
      const stateChanged = !currentState || 
        newState.status !== currentState.status || 
        newState.last_event_seq !== currentState.last_event_seq ||
        newState.candidate_dark_since !== currentState.candidate_dark_since;

      if (stateChanged) {
        await tx.poleState.upsert({
          where: { pole_id: eventRecord.pole_id },
          update: {
            status: newState.status,
            last_confirmed_at: new Date(newState.last_confirmed_at),
            last_event_seq: newState.last_event_seq,
            candidate_dark_since: newState.candidate_dark_since ? new Date(newState.candidate_dark_since) : null,
            evidence_summary: newState.evidence_summary,
            evidence_type: newState.evidence_type
          },
          create: {
            pole_id: eventRecord.pole_id,
            status: newState.status,
            last_confirmed_at: new Date(newState.last_confirmed_at),
            last_event_seq: newState.last_event_seq,
            candidate_dark_since: newState.candidate_dark_since ? new Date(newState.candidate_dark_since) : null,
            evidence_summary: newState.evidence_summary,
            evidence_type: newState.evidence_type
          }
        });

        // 5. Localization reads confirmed status only. Skipping candidate-only and
        // heartbeat events keeps the worker ahead of the debounce during a feeder-wide burst.
        const statusChanged = !currentState || newState.status !== currentState.status;
        if (statusChanged) {
          const pole = await tx.pole.findUnique({ where: { id: eventRecord.pole_id } });
          if (pole && pole.dt_id) {
            if (newState.status === 'LIVE') {
              restoredDts.add(pole.dt_id);
            } else {
              const { incidents } = await runLocalizationForDt(pole.dt_id, tx);

              // 6. Sync incidents
              await syncIncidents(incidents, pole.dt_id, tx);
            }
          }
        }
      }

      // Always update device.last_seen to the event's server_received_at.
      // This is correct regardless of whether PoleState changed: if a device
      // sent any telemetry (heartbeat, power_lost, power_restored, boot), it
      // was demonstrably alive at that moment. The sweeper's heartbeat-timeout
      // scan (Section H Rule 4) reads device.last_seen to detect silence, so
      // keeping it current prevents healthy devices from triggering false timeouts.
      // No fw-1.2.x special treatment is needed here: a healthy fw<1.3 device
      // heartbeats like any other, and simply goes silent (no power_lost) once
      // it loses power, so its last_seen stops refreshing and it times out.
      await tx.device.updateMany({
        where: { pole_id: eventRecord.pole_id },
        data: { last_seen: eventRecord.server_received_at },
      });

      // Testing hook for crash recovery simulation
      if (process.env.SIMULATE_CRASH === '1') {
        throw new Error('Simulated Crash Mid-Transaction');
      }

      // 7. Mark row as PROCESSED
      await tx.telemetryInbox.update({
        where: { id: rowId },
        data: { 
          status: 'PROCESSED',
          processed_at: new Date()
        }
      });

      return true;
    } catch (err) {
      console.error(`[Worker] Error processing inbox row ${rowId}:`, err);
      // In a real system, you might mark the row as FAILED if it's a non-transient error.
      // But since we want to test crash recovery, we rethrow to abort the transaction.
      throw err;
    }
  });
}
