/**
 * @file frontier.js
 *
 * Localization Engine — Span-Level Frontier Detection
 *
 * This is the core algorithm that translates per-pole observed states into
 * candidate span-level incidents by walking the DT topology tree top-down
 * and applying Section H boundary detection rules 1–4 & 7.
 *
 * This module is PURE: no DB access, no side effects. The caller is responsible
 * for loading and supplying the topology edges and pole states.
 *
 * Section H reference:
 *   Rule 2 — frontier edge: parent LIVE + child subtree has ≥1 CONFIRMED_DARK, no LIVE between
 *   Rule 3 — collapse: emit only the topmost frontier edge in a dark region
 *   Rule 4 — sensor anomaly: CONFIRMED_DARK with a LIVE descendant → SENSOR_SUSPECT, no ticket
 *   Rule 7 — range prep: unmonitored pole at a frontier boundary → flag as a RANGE edge
 */

/**
 * @typedef {Object} FrontierEdge
 * @property {string}  parent_pole_id
 * @property {string}  child_pole_id
 * @property {'AUTHORITATIVE'|'INFERRED'} source   – topology source of the crossing edge
 * @property {boolean} ambiguous                   – from the topology edge
 */

/**
 * @typedef {Object} RangeEdge
 * @property {string}              parent_pole_id
 * @property {string}              child_pole_id
 * @property {'parent'|'child'|'both'} missing_side  – which side has no device
 */

/**
 * @typedef {Object} FrontierResult
 * @property {FrontierEdge[]} frontierEdges  – topmost fault-boundary span edges
 * @property {string[]}       sensorSuspects – pole IDs reclassified as SENSOR_SUSPECT
 * @property {RangeEdge[]}    rangeEdges     – frontier edges where ≥1 endpoint is unmonitored
 */

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Builds an adjacency map and locates the tree root from a flat edge list.
 *
 * @param {object[]} edges  TopologyEdge[]
 * @returns {{ childrenOf: Map<string,string[]>, roots: Set<string> }}
 */
export function buildAdjacency(edges) {
  const childrenOf = new Map();
  const childSet = new Set(edges.map((e) => e.child_pole_id));
  const parentSet = new Set(edges.map((e) => e.parent_pole_id));

  for (const e of edges) {
    if (!childrenOf.has(e.parent_pole_id)) childrenOf.set(e.parent_pole_id, []);
    childrenOf.get(e.parent_pole_id).push(e.child_pole_id);
  }

  // Roots are parents that are never a child
  const roots = new Set([...parentSet].filter((id) => !childSet.has(id)));

  return { childrenOf, roots };
}

/**
 * Returns an object with an edge keyed by (parent_id → child_id).
 * Used for O(1) lookup of topology-source / ambiguous flag when building FrontierEdges.
 *
 * @param {object[]} edges
 * @returns {Map<string, object>}  key: `${parent}→${child}`
 */
function buildEdgeMap(edges) {
  const map = new Map();
  for (const e of edges) {
    map.set(`${e.parent_pole_id}→${e.child_pole_id}`, e);
  }
  return map;
}

/**
 * Determines whether a subtree rooted at `nodeId` contains at least one
 * CONFIRMED_DARK pole (after pruning stopped-search nodes).
 *
 * @param {string}                  nodeId
 * @param {Map<string,string[]>}    childrenOf
 * @param {Map<string,{status:string}>} poleStates
 * @param {Set<string>}             stopAt    – do not descend past these (pruned nodes)
 * @returns {boolean}
 */
function subtreeHasDark(nodeId, childrenOf, poleStates, stopAt) {
  const state = poleStates.get(nodeId);
  if (state && state.status === 'CONFIRMED_DARK') return true;

  if (stopAt.has(nodeId)) return false;

  for (const child of childrenOf.get(nodeId) || []) {
    if (subtreeHasDark(child, childrenOf, poleStates, stopAt)) return true;
  }
  return false;
}

/**
 * Determines whether a subtree rooted at `nodeId` contains at least one
 * LIVE pole.
 *
 * @param {string}                      nodeId
 * @param {Map<string,string[]>}        childrenOf
 * @param {Map<string,{status:string}>} poleStates
 * @returns {boolean}
 */
function subtreeHasLive(nodeId, childrenOf, poleStates) {
  const state = poleStates.get(nodeId);
  if (state && state.status === 'LIVE') return true;

  for (const child of childrenOf.get(nodeId) || []) {
    if (subtreeHasLive(child, childrenOf, poleStates)) return true;
  }
  return false;
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Detects span-level frontier edges for a single DT subtree.
 *
 * The caller must supply:
 *   - edges: the flat topology edge list for this DT (authoritative or inferred)
 *   - poleStates: a Map from pole_id → { status, ... }  (only the status field is used here)
 *   - poleMap: a Map from pole_id → { device_id, ... }  (used to detect unmonitored poles)
 *
 * @param {object[]}                     edges       TopologyEdge[]
 * @param {Map<string,{status:string}>}  poleStates  keyed by pole_id
 * @param {Map<string,{device_id?:string}>} poleMap  keyed by pole_id
 * @returns {FrontierResult}
 */
export function detectFrontier(edges, poleStates, poleMap) {
  if (!edges || edges.length === 0) {
    return { frontierEdges: [], sensorSuspects: [], rangeEdges: [] };
  }

  const { childrenOf, roots } = buildAdjacency(edges);
  const edgeMap = buildEdgeMap(edges);

  /** @type {FrontierEdge[]} */
  const frontierEdges = [];
  /** @type {Set<string>} */
  const sensorSuspectsSet = new Set();
  /** @type {RangeEdge[]} */
  const rangeEdges = [];

  /**
   * Recursive top-down walk.
   *
   * @param {string}  nodeId
   * @param {boolean} parentEffectiveLive  – true if parent side resolves LIVE (or assumed live)
   * @param {Set<string>} collapsedFrontiers – nodes already consumed by a topmost frontier (Rule 3)
   */
  function walk(nodeId, parentEffectiveLive, collapsedFrontiers) {
    // Skip nodes already inside a collapsed dark region
    if (collapsedFrontiers.has(nodeId)) return;

    const state = poleStates.get(nodeId);
    const pole = poleMap.get(nodeId);
    const isMonitored = pole && pole.device_id !== null;
    const status = state ? state.status : null;

    // ── Rule 4 (pre-check): is THIS node a sensor suspect? ──────────────────
    // A CONFIRMED_DARK pole with any LIVE descendant violates the radial invariant.
    // We must detect this BEFORE deciding to emit a frontier edge into this node.
    // Note: this only applies when the node itself is CONFIRMED_DARK.
    const isSensorSuspect =
      status === 'CONFIRMED_DARK' && subtreeHasLive(nodeId, childrenOf, poleStates);

    if (isSensorSuspect) {
      sensorSuspectsSet.add(nodeId);
    }

    // ── Rule 2: Effective live-ness of this node ─────────────────────────────
    // An unmonitored pole has no observable state → treat as effectively LIVE
    // (we cannot assume dark without evidence) per Section H Rule 2 & G.
    // A sensor-suspect pole is also treated as effectively LIVE (not a real fault).
    const effectiveLive =
      isSensorSuspect || // sensor suspect → treated as live for the walk
      status === 'LIVE' ||
      !isMonitored; // unmonitored (no device) → assumed live

    // ── Rule 2 & 3: Frontier detection ───────────────────────────────────────
    // Walk children. For each child, decide if the edge is a frontier edge.
    for (const childId of childrenOf.get(nodeId) || []) {
      const childState = poleStates.get(childId);
      const childPole = poleMap.get(childId);
      const childMonitored = childPole && childPole.device_id !== null;
      const childStatus = childState ? childState.status : null;

      // ── Rule 4 (child pre-check): sensor suspect? ─────────────────────────
      // Before considering this edge a frontier, check if child itself is a
      // sensor suspect (CONFIRMED_DARK with a LIVE descendant). If so, treat
      // child as live and continue the walk through it.
      const childIsSensorSuspect =
        childStatus === 'CONFIRMED_DARK' && subtreeHasLive(childId, childrenOf, poleStates);

      if (childIsSensorSuspect) {
        sensorSuspectsSet.add(childId);
        // Treat child as live, continue walk through it
        walk(childId, true, collapsedFrontiers);
        continue;
      }

      // ── Rule 2: Is the parent side effectively live? ──────────────────────
      const thisNodeIsLive = parentEffectiveLive || effectiveLive;

      // An unmonitored child is assumed live too — the frontier can pass through it.
      const childEffectiveLive = childStatus === 'LIVE' || !childMonitored;

      // Child subtree has at least one CONFIRMED_DARK pole
      const childSubtreeDark = subtreeHasDark(childId, childrenOf, poleStates, new Set());

      // ── Frontier edge criterion ────────────────────────────────────────────
      // Parent side is live AND child subtree has dark AND child itself is not live.
      if (thisNodeIsLive && childSubtreeDark && !childEffectiveLive) {
        // Found a frontier edge — emit it (Rule 2)
        const topoEdge = edgeMap.get(`${nodeId}→${childId}`);

        /** @type {FrontierEdge} */
        const frontierEdge = {
          parent_pole_id: nodeId,
          child_pole_id: childId,
          source: topoEdge ? topoEdge.source : 'INFERRED',
          ambiguous: topoEdge ? topoEdge.ambiguous : false,
        };
        frontierEdges.push(frontierEdge);

        // Rule 7: flag range edge if either endpoint is unmonitored
        const parentMonitored = isMonitored;

        if (!parentMonitored || !childMonitored) {
          const missingSide =
            !parentMonitored && !childMonitored ? 'both' :
            !parentMonitored ? 'parent' : 'child';
          rangeEdges.push({ parent_pole_id: nodeId, child_pole_id: childId, missing_side: missingSide });
        }

        // Rule 3: Collapse — do NOT descend into this dark subtree further.
        const collapseQueue = [childId];
        while (collapseQueue.length > 0) {
          const curr = collapseQueue.pop();
          collapsedFrontiers.add(curr);
          for (const gc of childrenOf.get(curr) || []) collapseQueue.push(gc);
        }
      } else if (thisNodeIsLive && childSubtreeDark && childEffectiveLive) {
        // Child is unmonitored (assumed live) but subtree below has dark.
        // Push the frontier further downstream — continue the walk into this child.
        walk(childId, true /* assumed live */, collapsedFrontiers);
      } else {
        // Not a frontier — continue walking downward
        walk(childId, thisNodeIsLive, collapsedFrontiers);
      }
    }
  }

  const collapsed = new Set();
  for (const root of roots) {
    const rootState = poleStates.get(root);
    const rootPole = poleMap.get(root);
    const rootMonitored = rootPole && rootPole.device_id !== null;
    const rootStatus = rootState ? rootState.status : null;
    // Root is effectively live unless it's CONFIRMED_DARK by a monitored device
    const rootLive = rootStatus !== 'CONFIRMED_DARK' || !rootMonitored;
    walk(root, rootLive, collapsed);
  }

  return { frontierEdges, sensorSuspects: Array.from(sensorSuspectsSet), rangeEdges };
}


