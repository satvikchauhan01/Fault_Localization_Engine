import { detectFrontier } from './frontier.js';
import { evaluateDtRollup, applyRollup } from './rollup.js';
import { expandRangeIncident } from './range.js';
import { buildConfidenceEvidence, evaluateConfidence } from './confidence.js';
import { buildAdjacency } from './frontier.js'; // to get childrenOf

/**
 * Runs the full localization pipeline for a single DT subtree.
 * Fetches all necessary state from the database, runs the pure pure localization
 * functions, and returns a list of actionable incidents (faults).
 * 
 * @param {string} dtId The DT ID to localize
 * @param {object} tx Prisma transaction client
 * @returns {Promise<{ incidents: any[], sensorSuspects: string[] }>}
 */
export async function runLocalizationForDt(dtId, tx) {
  // 1. Fetch Topology
  const poles = await tx.pole.findMany({
    where: { dt_id: dtId }
  });
  const poleIds = poles.map(p => p.id);

  const edges = await tx.topologyEdge.findMany({
    where: { child_pole_id: { in: poleIds } }
  });

  const devices = await tx.device.findMany({
    where: { pole_id: { in: poleIds } }
  });

  const states = await tx.poleState.findMany({
    where: { pole_id: { in: poleIds } }
  });

  // 2. Build Maps
  const deviceMap = new Map();
  for (const d of devices) {
    if (d.pole_id) deviceMap.set(d.pole_id, d.id);
  }

  const stateMap = new Map();
  for (const s of states) stateMap.set(s.pole_id, s);

  const edgeMap = new Map();
  for (const e of edges) edgeMap.set(`${e.parent_pole_id}→${e.child_pole_id}`, e);

  const poleMap = new Map();
  const poleStates = new Map();

  for (const pole of poles) {
    const devId = pole.device_id || deviceMap.get(pole.id) || null;
    poleMap.set(pole.id, { device_id: devId });
    
    const s = stateMap.get(pole.id);
    if (s) {
      poleStates.set(pole.id, {
        status: s.status,
        last_confirmed_at: s.last_confirmed_at ? s.last_confirmed_at.getTime() : null,
        evidence_summary: s.evidence_summary,
        evidence_type: s.evidence_type,
      });
    }
    // Do not fabricate a LIVE state if none exists in the DB.
    // Missing telemetry remains missing, allowing pure logic to infer appropriately.
  }

  const { childrenOf } = buildAdjacency(edges);

  // 3. Run frontier detection
  const { frontierEdges, sensorSuspects, rangeEdges } = detectFrontier(edges, poleStates, poleMap);

  // 4. Evaluate DT rollup
  const dtRollup = evaluateDtRollup(dtId, poleIds, poleStates, poleMap);
  const dtRollups = new Map();
  dtRollups.set(dtId, dtRollup);

  // 5. Apply Rollup
  const poleIdToDtId = new Map();
  for (const id of poleIds) poleIdToDtId.set(id, dtId);

  const { incidents: baseIncidents } = applyRollup(
    frontierEdges,
    dtRollups,
    null, // no feeder rollup computed here
    poleIdToDtId
  );

  const finalIncidents = [];

  // 6. Expand ranges and evaluate confidence
  for (const inc of baseIncidents) {
    if (inc.type === 'DT_FAULT') {
      const evidence = buildConfidenceEvidence(
        { source: 'AUTHORITATIVE', ambiguous: false, child_pole_id: inc.affected_pole_ids[0] }, 
        null, 
        [], 
        false, 
        poleStates, 
        inc.affected_pole_ids
      );
      const conf = evaluateConfidence(evidence);
      finalIncidents.push({
        ...inc,
        confidence: conf.level,
        confidence_reasons: conf.reasons,
        topology_source: 'AUTHORITATIVE', // DT rollup relies on membership, usually authoritative
      });
    } else {
      // It's a SPAN fault (FrontierEdge)
      const isRange = rangeEdges.some(r => r.child_pole_id === inc.child_pole_id && r.parent_pole_id === inc.parent_pole_id);
      
      let localizedInc;
      if (isRange) {
        localizedInc = expandRangeIncident(inc, childrenOf, poleStates, poleMap, edgeMap);
      } else {
        // Standard SPAN
        const edge = edgeMap.get(`${inc.parent_pole_id}→${inc.child_pole_id}`);
        // To build affected_pole_ids we traverse down
        const affected = [];
        const queue = [inc.child_pole_id];
        while (queue.length > 0) {
          const curr = queue.shift();
          affected.push(curr);
          for (const child of childrenOf.get(curr) || []) {
            queue.push(child);
          }
        }
        
        localizedInc = {
          type: 'SPAN',
          upstream_live_pole_id: inc.parent_pole_id,
          downstream_dark_pole_ids: [inc.child_pole_id],
          affected_pole_ids: affected,
          affected_count: affected.length,
          topology_source: edge ? edge.source : 'AUTHORITATIVE',
          ambiguous: edge ? edge.ambiguous : false,
        };
      }

      const evidence = buildConfidenceEvidence(
        localizedInc, 
        isRange ? localizedInc : null, 
        sensorSuspects, 
        false, 
        poleStates, 
        localizedInc.affected_pole_ids
      );
      const conf = evaluateConfidence(evidence);
      
      finalIncidents.push({
        ...localizedInc,
        confidence: conf.level,
        confidence_reasons: conf.reasons
      });
    }
  }

  return { incidents: finalIncidents, sensorSuspects };
}
