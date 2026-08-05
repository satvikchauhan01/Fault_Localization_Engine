import { detectFrontier } from './frontier.js';
import { evaluateDtRollup, evaluateFeederRollup, applyRollup } from './rollup.js';
import { expandRangeIncident } from './range.js';
import { buildConfidenceEvidence, evaluateConfidence } from './confidence.js';
import { buildAdjacency } from './frontier.js'; // to get childrenOf
import { checkScheduledOutageOverlap } from '../scheduled-outages/adapter.js';

/**
 * Runs the full localization pipeline for a single DT subtree.
 * Fetches all necessary state from the database, runs the pure localization
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

  const transformer = await tx.transformer.findUnique({
    where: { id: dtId }
  });
  const feederId = transformer ? transformer.feeder_id : (poles[0]?.feeder_id || null);
  const feederTransformers = feederId
    ? await tx.transformer.findMany({ where: { feeder_id: feederId } })
    : [];
  const feederDtIds = feederTransformers.map(dt => dt.id);

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
    if (d.pole_id) deviceMap.set(d.pole_id, { id: d.id, fw_version: d.fw_version });
  }

  const stateMap = new Map();
  for (const s of states) stateMap.set(s.pole_id, s);

  const edgeMap = new Map();
  for (const e of edges) edgeMap.set(`${e.parent_pole_id}→${e.child_pole_id}`, e);

  const poleMap = new Map();
  const poleStates = new Map();

  for (const pole of poles) {
    const dev = deviceMap.get(pole.id) || null;
    poleMap.set(pole.id, { 
      device_id: dev ? dev.id : (pole.device_id || null),
      fw_version: dev ? dev.fw_version : null
    });
    
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
  let dtRollups = new Map();
  let feederRollup = null;
  let rollupPoleStates = poleStates;
  let rollupPoleMap = poleMap;
  let rollupPoleIds = poleIds;
  let feederTopologySource = transformer?.topology_source === 'MISSING' ? 'INFERRED' : 'AUTHORITATIVE';

  if (feederId && feederDtIds.length > 0) {
    const feederPoles = await tx.pole.findMany({
      where: { feeder_id: feederId }
    });
    rollupPoleIds = feederPoles.map(p => p.id);

    const [feederDevices, feederStates] = await Promise.all([
      tx.device.findMany({ where: { pole_id: { in: rollupPoleIds } } }),
      tx.poleState.findMany({ where: { pole_id: { in: rollupPoleIds } } }),
    ]);

    const feederDeviceMap = new Map();
    for (const d of feederDevices) {
      if (d.pole_id) feederDeviceMap.set(d.pole_id, { id: d.id, fw_version: d.fw_version });
    }

    rollupPoleMap = new Map();
    rollupPoleStates = new Map();
    for (const pole of feederPoles) {
      const dev = feederDeviceMap.get(pole.id) || null;
      rollupPoleMap.set(pole.id, {
        device_id: dev ? dev.id : (pole.device_id || null),
        fw_version: dev ? dev.fw_version : null
      });
    }
    for (const s of feederStates) {
      rollupPoleStates.set(s.pole_id, {
        status: s.status,
        last_confirmed_at: s.last_confirmed_at ? s.last_confirmed_at.getTime() : null,
        evidence_summary: s.evidence_summary,
        evidence_type: s.evidence_type,
      });
    }

    const dtPoleMap = new Map();
    for (const pole of feederPoles) {
      if (!dtPoleMap.has(pole.dt_id)) dtPoleMap.set(pole.dt_id, []);
      dtPoleMap.get(pole.dt_id).push(pole.id);
    }

    const rollupResult = evaluateFeederRollup(
      feederId,
      feederDtIds,
      dtPoleMap,
      rollupPoleStates,
      rollupPoleMap
    );
    feederRollup = rollupResult.feederRollup;
    dtRollups = rollupResult.dtRollups;
    feederTopologySource = feederTransformers.some(dt => dt.topology_source === 'MISSING')
      ? 'INFERRED'
      : 'AUTHORITATIVE';
  } else {
    dtRollups.set(dtId, evaluateDtRollup(dtId, poleIds, poleStates, poleMap));
  }

  // 5. Apply Rollup
  const poleIdToDtId = new Map();
  for (const id of poleIds) poleIdToDtId.set(id, dtId);

  const { incidents: baseIncidents } = applyRollup(
    frontierEdges,
    dtRollups,
    feederRollup,
    poleIdToDtId
  );

  const finalIncidents = [];

  // 6. Expand ranges and evaluate confidence
  for (const inc of baseIncidents) {
    if (inc.type === 'DT_FAULT' || inc.type === 'FEEDER_FAULT') {
      const isFeederFault = inc.type === 'FEEDER_FAULT';
      const rollupTopologySource = isFeederFault
        ? feederTopologySource
        : (transformer?.topology_source === 'MISSING' ? 'INFERRED' : 'AUTHORITATIVE');
      const hasOutageOverlap = await checkScheduledOutageOverlap({
        dtId: isFeederFault ? null : dtId,
        feederId,
        affectedPoleIds: inc.affected_pole_ids,
        incidentTime: Date.now(),
      }, tx);

      const evidence = buildConfidenceEvidence(
        { source: rollupTopologySource, ambiguous: false, child_pole_id: inc.affected_pole_ids[0] }, 
        null, 
        [], 
        hasOutageOverlap, 
        isFeederFault ? rollupPoleStates : poleStates, 
        inc.affected_pole_ids
      );
      const conf = evaluateConfidence(evidence);
      finalIncidents.push({
        ...inc,
        type: isFeederFault ? 'FEEDER' : 'DT',
        upstream_live_pole_id: null,
        downstream_dark_pole_ids: inc.downstream_dark_pole_ids || inc.affected_pole_ids || [],
        affected_count: inc.affected_count || (inc.affected_pole_ids ? inc.affected_pole_ids.length : 0),
        confidence: conf.level,
        confidence_reasons: conf.reasons,
        scheduled_outage_overlap: evidence.scheduled_outage_overlap,
        topology_source: rollupTopologySource,
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

      const hasOutageOverlap = await checkScheduledOutageOverlap({
        dtId,
        feederId,
        affectedPoleIds: localizedInc.affected_pole_ids,
        incidentTime: Date.now(),
      }, tx);

      const evidence = buildConfidenceEvidence(
        localizedInc, 
        isRange ? localizedInc : null, 
        sensorSuspects, 
        hasOutageOverlap, 
        poleStates, 
        localizedInc.affected_pole_ids
      );
      const conf = evaluateConfidence(evidence);
      
      finalIncidents.push({
        ...localizedInc,
        confidence: conf.level,
        confidence_reasons: conf.reasons,
        scheduled_outage_overlap: evidence.scheduled_outage_overlap,
      });
    }
  }

  const groupedFinalIncidents = [];
  const parentGroups = new Map();

  for (const inc of finalIncidents) {
    if (inc.type === 'DT' || inc.type === 'FEEDER') {
      groupedFinalIncidents.push(inc);
      continue;
    }
    
    // For SPAN or RANGE, group by upstream_live_pole_id
    const parentId = inc.upstream_live_pole_id;
    if (!parentGroups.has(parentId)) {
      parentGroups.set(parentId, []);
    }
    parentGroups.get(parentId).push(inc);
  }

  for (const [parentId, incs] of parentGroups.entries()) {
    if (incs.length === 1) {
      groupedFinalIncidents.push(incs[0]);
    } else {
      // Merge multiple branches into a single incident
      const hasRange = incs.some(i => i.type === 'RANGE');
      const allDownstream = [...new Set(incs.flatMap(i => i.downstream_dark_pole_ids || []))];
      const allAffected = [...new Set(incs.flatMap(i => i.affected_pole_ids || []))];
      
      const confLevels = { 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };
      const lowestConfInc = incs.reduce((a, b) => confLevels[a.confidence] < confLevels[b.confidence] ? a : b);
      
      groupedFinalIncidents.push({
        ...incs[0],
        type: hasRange ? 'RANGE' : 'SPAN',
        downstream_dark_pole_ids: allDownstream,
        affected_pole_ids: allAffected,
        affected_count: allAffected.length,
        confidence: lowestConfInc.confidence,
        confidence_reasons: Array.from(new Set(incs.flatMap(i => i.confidence_reasons || [])))
      });
    }
  }

  return { incidents: groupedFinalIncidents, sensorSuspects };
}
