/**
 * DT and FEEDER incidents have no upstream_live_pole_id (that field only
 * applies to SPAN/RANGE faults) — without this, those cards render an empty
 * "Upstream Target:" line. Centralized here so list/detail/notification
 * views describe every incident type consistently.
 */
export function getIncidentLabel(incident) {
  if (incident.upstream_live_pole_id) return incident.upstream_live_pole_id;
  if (incident.type === 'FEEDER') return 'Feeder-level fault';
  if (incident.type === 'DT') return 'DT-level fault';
  if (incident.type === 'RANGE') return 'Unmonitored range';
  return 'Unknown target';
}
