/**
 * @file range.js
 *
 * Localization Engine — RANGE incident expansion (Section H Rule 7, Section G)
 *
 * This module is PURE: no DB access, no side effects. All thresholds are
 * imported from @kspdb/domain/thresholds — no inline numeric literals.
 *
 * A RANGE incident is produced when the true fault boundary cannot be pinpointed
 * to a single span edge because one or more poles in the relevant segment are
 * UNMONITORED (device_id = null). In that case we bound the fault by:
 *   - upstream_live_pole_id: the nearest monitored LIVE ancestor
 *   - downstream_dark_pole_ids: the first monitored CONFIRMED_DARK descendants
 *
 * Section G rules that apply here:
 *   - "A 'range' localization = an explicit ordered list of bounding poles
 *     (last-confirmed-LIVE ancestor + first-confirmed-DARK descendants), never
 *     a fabricated lat/lon guess."
 *   - "If the true failed edge sits between two unmonitored poles, we can only
 *     bound it by the nearest monitored LIVE ancestor and nearest monitored
 *     DARK descendants."
 *   - "Confidence capped at MEDIUM even under authoritative topology, since the
 *     exact span is unobservable in principle."
 *
 * NOTE: This module reads ONLY from registry structures (pole maps, topology
 * edges, pole states). It MUST NOT import from generate-ground-truth.js or
 * query any sim_true_* data.
 */

import { RANGE_LOW_CONFIDENCE_POLE_CUTOFF } from '../../../../packages/domain/src/thresholds.js';

/**
 * @typedef {Object} RangeIncident
 * @property {'RANGE'} type
 * @property {string|null} upstream_live_pole_id    Nearest monitored LIVE ancestor pole
 * @property {string[]}   downstream_dark_pole_ids  First monitored DARK descendant poles
 * @property {string[]}   unmonitored_pole_ids      Unmonitored poles in the bounded gap
 * @property {number}     gap_pole_count            Total poles in the bounded gap (monitored + unmonitored)
 * @property {boolean}    low_confidence_by_size    True when gap_pole_count > RANGE_LOW_CONFIDENCE_POLE_CUTOFF
 * @property {string}     topology_source           AUTHORITATIVE or INFERRED
 * @property {boolean}    ambiguous                 True if any edge in the gap is ambiguous
 */

/**
 * Expands a frontier edge that touches an unmonitored pole into a RANGE incident.
 *
 * A RANGE incident is created when a frontier edge has `missing_side: 'parent'`,
 * `'child'`, or `'both'` — meaning the fault boundary passes through unmonitored
 * territory. This function determines the full bounded range by walking the tree
 * to find:
 *   - The nearest monitored LIVE ancestor (upstream boundary)
 *   - The nearest monitored DARK descendant(s) (downstream boundary)
 *   - All unmonitored poles inside the gap
 *
 * @param {object}                              rangeEdge        A RangeEdge from detectFrontier()
 * @param {Map<string, string[]>}               childrenOf       adjacency map (pole → children)
 * @param {Map<string, {status: string}>}       poleStates       Current pole states
 * @param {Map<string, {device_id: string|null}>} poleMap        Registry pole metadata
 * @param {Map<string, object>}                 edgeMap          Map of 'parentId→childId' → edge object
 * @returns {RangeIncident}
 */
export function expandRangeIncident(rangeEdge, childrenOf, poleStates, poleMap, edgeMap) {
  const { parent_pole_id, child_pole_id } = rangeEdge;

  // Determine which side is unmonitored
  const parentPole = poleMap.get(parent_pole_id);
  const childPole = poleMap.get(child_pole_id);
  const parentIsUnmonitored = !parentPole || parentPole.device_id === null;
  const childIsUnmonitored = !childPole || childPole.device_id === null;

  // The upstream boundary is the live parent (if monitored) or null (if not)
  // The frontier already guarantees: parent side = LIVE (or assumed live).
  // If parent is unmonitored, upstream_live_pole_id = null (unknown boundary).
  const upstreamLivePoleId = parentIsUnmonitored ? null : parent_pole_id;

  // Collect all unmonitored poles inside the gap by walking from the unmonitored
  // child node(s) downward until hitting monitored poles.
  const unmonitoredPoleIds = [];
  const downstreamDarkPoleIds = [];
  let ambiguous = false;
  let topologySource = 'AUTHORITATIVE';

  /**
   * Walk from a given unmonitored pole downward to find:
   * - The monitored DARK poles that form the downstream boundary
   * - All unmonitored poles in between (gap)
   *
   * @param {string} nodeId      The current node being visited
   * @param {string} actualParentId  The actual parent of nodeId in the topology tree
   */
  function walkUnmonitored(nodeId, actualParentId) {
    const pole = poleMap.get(nodeId);
    const isMonitored = pole && pole.device_id !== null;

    if (!isMonitored) {
      unmonitoredPoleIds.push(nodeId);
      // Look up the edge from the ACTUAL parent to this node (not the frontier parent)
      const edgeKey = `${actualParentId}→${nodeId}`;
      const edge = edgeMap.get(edgeKey);
      if (edge) {
        if (edge.source === 'INFERRED') topologySource = 'INFERRED';
        if (edge.ambiguous) ambiguous = true;
      }
      // Continue walking children, passing nodeId as their actual parent
      for (const childId of childrenOf.get(nodeId) || []) {
        walkUnmonitored(childId, nodeId);
      }
    } else {
      // This is a monitored boundary pole — also check the incoming edge for INFERRED/ambiguous
      const boundaryEdgeKey = `${actualParentId}→${nodeId}`;
      const boundaryEdge = edgeMap.get(boundaryEdgeKey);
      if (boundaryEdge) {
        if (boundaryEdge.source === 'INFERRED') topologySource = 'INFERRED';
        if (boundaryEdge.ambiguous) ambiguous = true;
      }
      // Check its state
      const state = poleStates.get(nodeId);
      const status = state ? state.status : null;
      if (status === 'CONFIRMED_DARK') {
        downstreamDarkPoleIds.push(nodeId);
      }
      // Don't descend further — this is the boundary
    }
  }

  // If child is unmonitored, walk from the child; pass parent_pole_id as child's actual parent
  if (childIsUnmonitored) {
    walkUnmonitored(child_pole_id, parent_pole_id);
  } else {
    // Child is monitored and dark — it IS the downstream boundary directly
    downstreamDarkPoleIds.push(child_pole_id);
    const edgeObj = edgeMap.get(`${parent_pole_id}→${child_pole_id}`);
    if (edgeObj) {
      if (edgeObj.source === 'INFERRED') topologySource = 'INFERRED';
      if (edgeObj.ambiguous) ambiguous = true;
    }
  }

  // Total poles in the gap = unmonitored (gap poles) + the monitored dark endpoints
  const gapPoleCount = unmonitoredPoleIds.length + downstreamDarkPoleIds.length;

  return {
    type: 'RANGE',
    upstream_live_pole_id: upstreamLivePoleId,
    downstream_dark_pole_ids: downstreamDarkPoleIds,
    unmonitored_pole_ids: unmonitoredPoleIds,
    gap_pole_count: gapPoleCount,
    low_confidence_by_size: gapPoleCount > RANGE_LOW_CONFIDENCE_POLE_CUTOFF,
    topology_source: topologySource,
    ambiguous,
  };
}

/**
 * Converts all rangeEdges from detectFrontier() into full RANGE incidents.
 *
 * @param {object[]}                              rangeEdges   From detectFrontier()
 * @param {Map<string, string[]>}                 childrenOf
 * @param {Map<string, {status: string}>}         poleStates
 * @param {Map<string, {device_id: string|null}>} poleMap
 * @param {Map<string, object>}                   edgeMap
 * @returns {RangeIncident[]}
 */
export function buildRangeIncidents(rangeEdges, childrenOf, poleStates, poleMap, edgeMap) {
  return rangeEdges.map((re) =>
    expandRangeIncident(re, childrenOf, poleStates, poleMap, edgeMap)
  );
}
