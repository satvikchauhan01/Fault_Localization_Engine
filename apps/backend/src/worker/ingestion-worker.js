import { PrismaClient } from '@prisma/client';
import { runLocalizationForDt } from '../localization/orchestrator.js';
import { syncIncidents } from '../localization/incident-sync.js';

const prisma = new PrismaClient();

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
      ORDER BY server_received_at ASC 
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
      const deviceRecord = await tx.device.findFirst({ where: { pole_id: eventRecord.pole_id } });

      const eventObj = {
        event: eventRecord.event,
        energized: eventRecord.energized,
        seq: eventRecord.seq,
        server_received_at: eventRecord.server_received_at.getTime()
      };

      const { processEvent, evaluateTimeout } = await import('../localization/pole-state.js');
      
      let newState = processEvent(currentState, eventObj);

      // Attempt to immediately resolve debounce if the event is old enough
      // (This is primarily useful for integration tests or catching up on very stale events)
      const now = new Date().getTime();
      const timedOutState = evaluateTimeout(newState, deviceRecord, now);
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

        // 5. Trigger localization for the affected DT
        const pole = await tx.pole.findUnique({ where: { id: eventRecord.pole_id } });
        if (pole && pole.dt_id) {
          const dtId = pole.dt_id;
          const { incidents } = await runLocalizationForDt(dtId, tx);
          
          // 6. Sync incidents
          await syncIncidents(incidents, dtId, tx);
        }
      }

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
