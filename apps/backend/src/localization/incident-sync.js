import { randomUUID } from 'crypto';

/**
 * Persists the localized incidents to the database, ensuring idempotency.
 * 
 * Rules for idempotency:
 * - We search for an existing active (open ticket) incident on the same affected subset,
 *   or same boundary (upstream_live / downstream_dark).
 * - For simplicity in this demo, if the incident type and upstream_live match, we treat it as the same incident.
 * 
 * @param {any[]} computedIncidents 
 * @param {string} dtId
 * @param {object} tx Prisma transaction client
 */
export async function syncIncidents(computedIncidents, dtId, tx) {
  const poles = await tx.pole.findMany({ where: { dt_id: dtId } });
  const dtPoleIds = poles.map(p => p.id);

  // Fetch ALL active incidents that might belong to this DT
  // (Either upstream live pole is in DT, or we just fetch all active and filter in memory)
  const allActiveIncidents = await tx.incident.findMany({
    where: {
      ticket: { state: { notIn: ['VERIFIED', 'CLOSED'] } }
    },
    include: { ticket: true }
  });

  const activeForDt = allActiveIncidents.filter(inc => 
    (inc.upstream_live_pole_id && dtPoleIds.includes(inc.upstream_live_pole_id)) ||
    (Array.isArray(inc.affected_pole_ids) && inc.affected_pole_ids.some(id => dtPoleIds.includes(id)))
  );

  for (const inc of computedIncidents) {
    const overlappingIncidents = [];

    // Find all matching active incidents by checking if any of the newly computed affected_pole_ids
    // intersect with the existing incident's affected_pole_ids. If they intersect, it's the same physical fault.
    // We explicitly DO NOT check if activeInc.type === inc.type to allow for escalation (SPAN -> DT).
    for (const activeInc of activeForDt) {
      const existingAffected = Array.isArray(activeInc.affected_pole_ids) ? activeInc.affected_pole_ids : [];
      const newAffected = Array.isArray(inc.affected_pole_ids) ? inc.affected_pole_ids : [];
      const intersects = newAffected.some(id => existingAffected.includes(id));
      
      if (intersects) {
        overlappingIncidents.push(activeInc);
      }
    }

    if (overlappingIncidents.length > 0) {
      // Pick the primary incident to update (the oldest one)
      overlappingIncidents.sort((a, b) => new Date(a.first_detected_at) - new Date(b.first_detected_at));
      const existingIncident = overlappingIncidents[0];

      // Compute union of historically affected poles across ALL overlapping incidents
      let oldHistorical = [];
      for (const overlap of overlappingIncidents) {
        oldHistorical = oldHistorical.concat(Array.isArray(overlap.historical_affected_pole_ids) ? overlap.historical_affected_pole_ids : []);
      }
      const newAffected = Array.isArray(inc.affected_pole_ids) ? inc.affected_pole_ids : [];
      const updatedHistorical = [...new Set([...oldHistorical, ...newAffected])];

      // Type priority system: don't downgrade a ticket if it's currently a DT/Feeder fault
      // and we are just seeing a splinter SPAN fault during restoration.
      const TYPE_PRIORITY = { 'FEEDER': 4, 'FEEDER_FAULT': 4, 'DT': 3, 'DT_FAULT': 3, 'RANGE': 2, 'SPAN': 1 };
      const existingPriority = TYPE_PRIORITY[existingIncident.type] || 0;
      const newPriority = TYPE_PRIORITY[inc.type] || 0;

      if (newPriority >= existingPriority) {
        // Upgrade or keep at the same level.
        await tx.incident.update({
          where: { id: existingIncident.id },
          data: {
            type: inc.type, // Update type to allow escalation (e.g. SPAN -> DT)
            upstream_live_pole_id: inc.upstream_live_pole_id, // Might have expanded upstream
            downstream_dark_pole_ids: inc.downstream_dark_pole_ids,
            affected_pole_ids: inc.affected_pole_ids,
            historical_affected_pole_ids: updatedHistorical,
            affected_count: inc.affected_count,
            topology_source: inc.topology_source,
            confidence: inc.confidence,
            confidence_reasons: inc.confidence_reasons,
            scheduled_outage_overlap: inc.scheduled_outage_overlap ?? false
          }
        });
      } else {
        // De-escalation (splintering during restoration). 
        // DO NOT downgrade the ticket type or active bounds. Only absorb the history.
        await tx.incident.update({
          where: { id: existingIncident.id },
          data: {
            historical_affected_pole_ids: updatedHistorical
          }
        });
      }

      // Update the in-memory object so subsequent splinters in this run
      // see the accumulated history
      existingIncident.historical_affected_pole_ids = updatedHistorical;

      // DO NOT remove `existingIncident` from `activeForDt`!
      // This allows OTHER splinters in `computedIncidents` to ALSO find this same ticket and be absorbed.

      // We STILL want to remove the OTHER overlapping incidents so they aren't matched again, and close them.
      for (let i = 1; i < overlappingIncidents.length; i++) {
        const overlap = overlappingIncidents[i];
        const idx = activeForDt.indexOf(overlap);
        if (idx !== -1) activeForDt.splice(idx, 1);
        
        await tx.ticket.update({
          where: { id: overlap.ticket.id },
          data: { state: 'CLOSED', verified_at: new Date() }
        });
      }
    } else {
      // Create new incident & ticket
      const newId = randomUUID();
      await tx.incident.create({
        data: {
          id: newId,
          type: inc.type,
          upstream_live_pole_id: inc.upstream_live_pole_id,
          downstream_dark_pole_ids: inc.downstream_dark_pole_ids,
          affected_pole_ids: inc.affected_pole_ids,
          historical_affected_pole_ids: inc.affected_pole_ids,
          affected_count: inc.affected_count,
          topology_source: inc.topology_source,
          confidence: inc.confidence,
          confidence_reasons: inc.confidence_reasons,
          scheduled_outage_overlap: inc.scheduled_outage_overlap ?? false,
          ticket: {
            create: {
              id: randomUUID(),
              state: 'DETECTED'
            }
          }
        }
      });
    }
  }

  // NOTE: We DO NOT auto-resolve tickets here just because a fault boundary moved or
  // disappeared from the computed list. RESOLVED is reserved for actual crew repair workflow.
}
