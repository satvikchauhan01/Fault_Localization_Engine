/**
 * @file authoritative.js
 *
 * Topology Service — Authoritative Tree Builder.
 *
 * Builds the in-memory radial tree for DTs whose topology_source is 'RECORDED'.
 * All edges it produces are tagged `source: 'AUTHORITATIVE'`.
 *
 * Input:  registry poles for a single DT (the caller filters by dt_id).
 *         These poles already have parent_pole_id populated (Step 5 only nulls
 *         it for MISSING-topology DTs).
 *
 * Output: an array of TopologyEdge objects ready for insertion into the
 *         `topology_edges` table, plus a structural validity report.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  IMPORTANT — boundary constraint                                         │
 * │  This module reads ONLY from the registry pole array passed in as an     │
 * │  argument. It MUST NOT import from generate-ground-truth.js or query    │
 * │  any sim_true_* table. The boundary test (Step 25) enforces this.       │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

/**
 * @typedef {Object} RegistryPole
 * @property {string}      id
 * @property {string}      dt_id
 * @property {string}      feeder_id
 * @property {number}      lat
 * @property {number}      lon
 * @property {number|null} seq_on_line
 * @property {string|null} parent_pole_id
 * @property {string|null} device_id
 * @property {string|null} pincode
 */

/**
 * @typedef {Object} TopologyEdge
 * @property {string}  parent_pole_id
 * @property {string}  child_pole_id
 * @property {'AUTHORITATIVE'} source
 * @property {number}  weight     Haversine distance in metres between the two poles
 * @property {false}   ambiguous  Always false for authoritative edges
 */

/**
 * @typedef {Object} TreeBuildResult
 * @property {TopologyEdge[]} edges
 * @property {string[]}       warnings   Non-fatal issues (e.g. seq gap) that downgrade confidence
 * @property {string[]}       errors     Fatal issues (cycle, broken tree) that prevent use
 * @property {boolean}        valid      true iff errors is empty
 */

// ─── Haversine distance ────────────────────────────────────────────────────

const EARTH_RADIUS_M = 6_371_000;

/**
 * Haversine distance in metres between two lat/lon points.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number}
 */
function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

// ─── Main export ───────────────────────────────────────────────────────────

/**
 * Builds the authoritative topology tree for a single RECORDED-topology DT.
 *
 * Steps:
 *  1. Validate input preconditions (all poles belong to same DT, IDs unique).
 *  2. Verify exactly one root pole (parent_pole_id === null).
 *  3. Build a parent→children adjacency map and check for non-existent parents.
 *  4. DFS from root to detect cycles and orphaned subtrees.
 *  5. Validate seq_on_line consistency (child seq = parent seq + 1). Violations
 *     add a warning (not an error) because minor seq gaps are acceptable; they
 *     would downgrade confidence in the localization engine.
 *  6. Emit one TopologyEdge per parent→child link, computing haversine weight.
 *
 * @param {RegistryPole[]} poles  All poles belonging to ONE RECORDED-topology DT.
 * @param {string}         dtId  DT identifier (used only for error messages).
 * @returns {TreeBuildResult}
 */
export function buildAuthoritativeTree(poles, dtId) {
  const errors = [];
  const warnings = [];

  if (!poles || poles.length === 0) {
    errors.push(`DT ${dtId}: no poles provided`);
    return { edges: [], warnings, errors, valid: false };
  }

  // ── 1. Basic preconditions ───────────────────────────────────────────────
  const poleIds = new Set();
  for (const p of poles) {
    if (p.dt_id !== dtId) {
      errors.push(`Pole ${p.id} belongs to DT ${p.dt_id}, not ${dtId}`);
    }
    if (poleIds.has(p.id)) {
      errors.push(`Duplicate pole ID ${p.id} in DT ${dtId}`);
    }
    poleIds.add(p.id);
  }
  if (errors.length > 0) return { edges: [], warnings, errors, valid: false };

  // ── 2. Exactly one root ──────────────────────────────────────────────────
  const roots = poles.filter((p) => p.parent_pole_id === null);
  if (roots.length === 0) {
    errors.push(`DT ${dtId}: no root pole found (every pole has a parent_pole_id)`);
    return { edges: [], warnings, errors, valid: false };
  }
  if (roots.length > 1) {
    const ids = roots.map((p) => p.id).join(', ');
    errors.push(`DT ${dtId}: multiple root poles found: ${ids}`);
    return { edges: [], warnings, errors, valid: false };
  }

  // ── 3. Parent existence check & adjacency map ────────────────────────────
  const poleById = new Map(poles.map((p) => [p.id, p]));
  const childrenOf = new Map(); // parent_id → child[]

  for (const p of poles) {
    if (p.parent_pole_id === null) continue;

    if (!poleById.has(p.parent_pole_id)) {
      errors.push(
        `DT ${dtId}: pole ${p.id} references non-existent parent ${p.parent_pole_id}`
      );
      continue;
    }

    if (!childrenOf.has(p.parent_pole_id)) {
      childrenOf.set(p.parent_pole_id, []);
    }
    childrenOf.get(p.parent_pole_id).push(p.id);
  }
  if (errors.length > 0) return { edges: [], warnings, errors, valid: false };

  // ── 4. DFS: detect cycles and orphaned subtrees ──────────────────────────
  const visited = new Set();
  const stack = [roots[0].id];

  while (stack.length > 0) {
    const currId = stack.pop();
    if (visited.has(currId)) {
      errors.push(`DT ${dtId}: cycle detected at pole ${currId}`);
      break;
    }
    visited.add(currId);
    for (const childId of childrenOf.get(currId) || []) {
      stack.push(childId);
    }
  }

  if (errors.length === 0 && visited.size !== poles.length) {
    const orphans = poles.filter((p) => !visited.has(p.id)).map((p) => p.id);
    errors.push(
      `DT ${dtId}: ${orphans.length} orphaned pole(s) not reachable from root: ` +
        orphans.slice(0, 5).join(', ') +
        (orphans.length > 5 ? ` … (${orphans.length} total)` : '')
    );
  }

  if (errors.length > 0) return { edges: [], warnings, errors, valid: false };

  // ── 5 & 6. Build edges with seq_on_line validation ───────────────────────
  const edges = [];

  for (const child of poles) {
    if (child.parent_pole_id === null) continue; // root has no incoming edge

    const parent = poleById.get(child.parent_pole_id);

    // seq_on_line consistency check (warning, not error)
    if (
      child.seq_on_line !== null &&
      parent.seq_on_line !== null &&
      child.seq_on_line !== parent.seq_on_line + 1
    ) {
      warnings.push(
        `DT ${dtId}: seq_on_line gap — pole ${child.id} has seq ${child.seq_on_line} ` +
          `but parent ${parent.id} has seq ${parent.seq_on_line} (expected ${parent.seq_on_line + 1})`
      );
    }

    const weight = haversine(parent.lat, parent.lon, child.lat, child.lon);

    edges.push({
      parent_pole_id: parent.id,
      child_pole_id: child.id,
      source: 'AUTHORITATIVE',
      weight: Number(weight.toFixed(2)),
      ambiguous: false,
    });
  }

  return { edges, warnings, errors, valid: true };
}

/**
 * Builds authoritative trees for all RECORDED-topology DTs in the registry.
 *
 * Filters to only RECORDED DTs; silently skips MISSING-topology DTs (they will
 * be handled by the MST inference module in Step 8).
 *
 * @param {object[]} transformers  All registry Transformer records
 * @param {RegistryPole[]} poles   All registry Pole records
 * @returns {{ edges: TopologyEdge[], dtResults: Map<string, TreeBuildResult> }}
 */
export function buildAllAuthoritativeTrees(transformers, poles) {
  // Group poles by DT
  const polesByDt = new Map();
  for (const p of poles) {
    if (!polesByDt.has(p.dt_id)) polesByDt.set(p.dt_id, []);
    polesByDt.get(p.dt_id).push(p);
  }

  const allEdges = [];
  const dtResults = new Map();

  for (const dt of transformers) {
    if (dt.topology_source !== 'RECORDED') continue; // MISSING DTs handled in Step 8

    const dtPoles = polesByDt.get(dt.id) || [];
    const result = buildAuthoritativeTree(dtPoles, dt.id);
    dtResults.set(dt.id, result);

    if (result.valid) {
      allEdges.push(...result.edges);
    }
  }

  return { edges: allEdges, dtResults };
}
