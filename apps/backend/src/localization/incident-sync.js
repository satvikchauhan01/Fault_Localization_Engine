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
      ticket: { state: { notIn: ['RESOLVED', 'VERIFIED', 'CLOSED'] } }
    },
    include: { ticket: true }
  });

  const activeForDt = allActiveIncidents.filter(inc => 
    (inc.upstream_live_pole_id && dtPoleIds.includes(inc.upstream_live_pole_id)) ||
    (Array.isArray(inc.affected_pole_ids) && inc.affected_pole_ids.some(id => dtPoleIds.includes(id)))
  );

  for (const inc of computedIncidents) {
    let existingIncident = null;

    // Find a matching active incident by checking if any of the newly computed affected_pole_ids
    // intersect with the existing incident's affected_pole_ids. If they intersect, it's the same physical fault.
    for (const activeInc of activeForDt) {
      if (activeInc.type === inc.type) {
        const existingAffected = Array.isArray(activeInc.affected_pole_ids) ? activeInc.affected_pole_ids : [];
        const newAffected = Array.isArray(inc.affected_pole_ids) ? inc.affected_pole_ids : [];
        const intersects = newAffected.some(id => existingAffected.includes(id));
        
        if (intersects) {
          existingIncident = activeInc;
          break;
        }
      }
    }

    if (existingIncident) {
      // Compute union of historically affected poles
      const oldHistorical = Array.isArray(existingIncident.historical_affected_pole_ids) ? existingIncident.historical_affected_pole_ids : [];
      const newAffected = Array.isArray(inc.affected_pole_ids) ? inc.affected_pole_ids : [];
      const updatedHistorical = [...new Set([...oldHistorical, ...newAffected])];

      // Extend/Update existing incident in place. Preserve ticket identity!
      await tx.incident.update({
        where: { id: existingIncident.id },
        data: {
          upstream_live_pole_id: inc.upstream_live_pole_id, // Might have expanded upstream
          downstream_dark_pole_ids: inc.downstream_dark_pole_ids,
          affected_pole_ids: inc.affected_pole_ids,
          historical_affected_pole_ids: updatedHistorical,
          affected_count: inc.affected_count,
          topology_source: inc.topology_source,
          confidence: inc.confidence,
          confidence_reasons: inc.confidence_reasons
        }
      });
      // Remove it from activeForDt so we don't accidentally match it again for another distinct incident
      activeForDt.splice(activeForDt.indexOf(existingIncident), 1);
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
