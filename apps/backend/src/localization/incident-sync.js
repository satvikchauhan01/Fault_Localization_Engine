import { randomUUID } from 'crypto';

const TYPE_PRIORITY = { 'FEEDER': 4, 'FEEDER_FAULT': 4, 'DT': 3, 'DT_FAULT': 3, 'RANGE': 2, 'SPAN': 1 };

// When incidents merge, the survivor is the one an operator has moved furthest.
const WORKFLOW_RANK = { DETECTED: 0, ACKNOWLEDGED: 1, CREW_ASSIGNED: 2, RESOLVED: 3 };

/**
 * Persists the localized incidents to the database, ensuring idempotency.
 *
 * A computed incident whose affected poles intersect one or more active
 * incidents is the same physical fault: the most-progressed of those becomes
 * the survivor and absorbs the rest (history, earliest detection time). The
 * absorbed ones are deleted, never closed. A ticket closed this way would show
 * up in incident history as a fault that was worked and verified, when it was
 * only an intermediate picture of a fault that was still being localized.
 *
 * @param {any[]} computedIncidents
 * @param {string} dtId
 * @param {object} tx Prisma transaction client
 */
export async function syncIncidents(computedIncidents, dtId, tx) {
  if (computedIncidents.length === 0) return;

  // Worker, sweeper and any extra workers all sync; serialize them so two
  // transactions can't both see "no incident yet" and each open one.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(7302411)`;

  // Not filtered to dtId: computedIncidents may carry DT/FEEDER rollups for
  // other DTs on the same feeder, whose existing tickets must still be found.
  const activeIncidentsToCheck = await tx.incident.findMany({
    where: {
      ticket: { state: { notIn: ['VERIFIED', 'CLOSED'] } }
    },
    include: { ticket: true }
  });

  for (const inc of computedIncidents) {
    const newAffected = Array.isArray(inc.affected_pole_ids) ? inc.affected_pole_ids : [];
    const newAffectedSet = new Set(newAffected);

    // Intersecting affected poles means the same physical fault. Type is not
    // compared, so a SPAN can escalate into a DT or FEEDER incident.
    const overlappingIncidents = activeIncidentsToCheck.filter((activeInc) => {
      const existingAffected = Array.isArray(activeInc.affected_pole_ids) ? activeInc.affected_pole_ids : [];
      return existingAffected.some((id) => newAffectedSet.has(id));
    });

    if (overlappingIncidents.length === 0) {
      const newId = randomUUID();
      const created = await tx.incident.create({
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
        },
        include: { ticket: true }
      });
      // Later computed incidents in this same run must see it, not open a sibling.
      activeIncidentsToCheck.push(created);
      continue;
    }

    overlappingIncidents.sort((a, b) =>
      (WORKFLOW_RANK[b.ticket.state] ?? 0) - (WORKFLOW_RANK[a.ticket.state] ?? 0) ||
      new Date(a.first_detected_at) - new Date(b.first_detected_at)
    );
    const [survivor, ...absorbed] = overlappingIncidents;

    const historical = new Set(newAffected);
    for (const overlap of overlappingIncidents) {
      const past = Array.isArray(overlap.historical_affected_pole_ids) ? overlap.historical_affected_pole_ids : [];
      for (const id of past) historical.add(id);
    }
    const updatedHistorical = [...historical];

    const firstDetectedAt = new Date(Math.min(
      ...overlappingIncidents.map((o) => new Date(o.first_detected_at).getTime())
    ));

    const escalatesOrHolds = (TYPE_PRIORITY[inc.type] || 0) >= (TYPE_PRIORITY[survivor.type] || 0);
    const data = escalatesOrHolds
      ? {
          type: inc.type,
          upstream_live_pole_id: inc.upstream_live_pole_id,
          downstream_dark_pole_ids: inc.downstream_dark_pole_ids,
          affected_pole_ids: inc.affected_pole_ids,
          historical_affected_pole_ids: updatedHistorical,
          affected_count: inc.affected_count,
          topology_source: inc.topology_source,
          confidence: inc.confidence,
          confidence_reasons: inc.confidence_reasons,
          scheduled_outage_overlap: inc.scheduled_outage_overlap ?? false,
          first_detected_at: firstDetectedAt,
        }
      // De-escalation (a splinter during restoration): never downgrade the
      // survivor's type or bounds, only absorb the history.
      : {
          historical_affected_pole_ids: updatedHistorical,
          first_detected_at: firstDetectedAt,
        };

    await tx.incident.update({ where: { id: survivor.id }, data });
    Object.assign(survivor, data);

    for (const overlap of absorbed) {
      const idx = activeIncidentsToCheck.indexOf(overlap);
      if (idx !== -1) activeIncidentsToCheck.splice(idx, 1);
      // Ticket rows cascade with the incident.
      await tx.incident.delete({ where: { id: overlap.id } });
    }
  }

  // NOTE: We DO NOT auto-resolve tickets here just because a fault boundary moved or
  // disappeared from the computed list. RESOLVED is reserved for actual crew repair workflow.
}
