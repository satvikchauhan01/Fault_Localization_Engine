/**
 * Scheduled outages only ever adjust confidence for *real* incidents server-side
 * (see 02-DECISIONS.md #6) — they never touch actual telemetry/PoleState, and
 * deliberately never should (that's what keeps a genuine fault during planned
 * maintenance from being silently swallowed). This module is a purely
 * client-side, presentation-only derivation: "which poles fall inside an
 * outage window that is active right now" — used to color the map and tally
 * stats, with zero effect on incidents/tickets/localization.
 */

/**
 * @param {Array<{id:string, scope:'DT'|'FEEDER'|'SPAN', target_id:string, start:string, end:string}>} outages
 * @param {number} [now] Reference time (ms) — defaults to Date.now(), injectable for tests.
 * @returns {Array} outages whose [start, end] window contains `now`.
 */
export function getActiveOutages(outages, now = Date.now()) {
  return (outages || []).filter((o) => {
    const start = new Date(o.start).getTime();
    const end = new Date(o.end).getTime();
    return now >= start && now <= end;
  });
}

/**
 * Resolves each currently-active outage's scope (DT / FEEDER / SPAN) down to
 * the concrete pole IDs it covers, using the same topology data already
 * loaded for the map. SPAN scope's target_id is the span's upstream pole —
 * the outage covers that pole and everything downstream of it, mirroring how
 * a real SPAN fault propagates.
 *
 * @param {Array} outages
 * @param {Array<{id:string, dt_id?:string, feeder_id?:string}>} poles
 * @param {Array<{parent_pole_id:string, child_pole_id:string}>} topologyEdges
 * @param {number} [now]
 * @returns {Map<string, object>} pole_id -> the (first matching) active outage covering it
 */
export function resolveActiveOutagePoles(outages, poles, topologyEdges, now = Date.now()) {
  const poleToOutage = new Map();
  const activeOutages = getActiveOutages(outages, now);
  if (activeOutages.length === 0 || !poles?.length) return poleToOutage;

  let childrenByParent = null;
  const getChildren = (parentId) => {
    if (!childrenByParent) {
      childrenByParent = new Map();
      for (const edge of topologyEdges || []) {
        if (!childrenByParent.has(edge.parent_pole_id)) childrenByParent.set(edge.parent_pole_id, []);
        childrenByParent.get(edge.parent_pole_id).push(edge.child_pole_id);
      }
    }
    return childrenByParent.get(parentId) || [];
  };

  for (const outage of activeOutages) {
    let affectedIds = [];

    if (outage.scope === 'DT') {
      affectedIds = poles.filter((p) => p.dt_id === outage.target_id).map((p) => p.id);
    } else if (outage.scope === 'FEEDER') {
      affectedIds = poles.filter((p) => p.feeder_id === outage.target_id).map((p) => p.id);
    } else if (outage.scope === 'SPAN') {
      const visited = new Set();
      const queue = [outage.target_id];
      while (queue.length > 0) {
        const curr = queue.shift();
        if (visited.has(curr)) continue;
        visited.add(curr);
        for (const child of getChildren(curr)) queue.push(child);
      }
      affectedIds = [...visited];
    }

    for (const id of affectedIds) {
      if (!poleToOutage.has(id)) poleToOutage.set(id, outage);
    }
  }

  return poleToOutage;
}
