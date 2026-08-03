/**
 * @file inferred.js
 *
 * ⚠️ HEURISTIC FALLBACK — NOT GROUND TRUTH ⚠️
 *
 * This module infers electrical adjacency using a degree-constrained
 * Minimum Spanning Tree (MST) based on haversine GPS distances.
 *
 * IT ONLY RUNS for DTs where authoritative topology is MISSING.
 * The output is a BEST-GUESS approximation, not a verified physical fact.
 * Real lines may follow road easements rather than direct distance, meaning
 * this heuristic can and will occasionally guess wrong.
 *
 * All edges produced here MUST be tagged `source: 'INFERRED'`.
 * The downstream localization engine and confidence model MUST downgrade
 * incident confidence whenever relying on an INFERRED edge.
 * Do not present this output to operators as a known fact.
 */

const EARTH_RADIUS_M = 6_371_000;
const MAX_DEGREE = 4; // Max children per pole
const AMBIGUITY_TOLERANCE = 0.15; // 15% threshold for ambiguous edges

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

/**
 * Builds a best-guess MST for a single MISSING-topology DT.
 *
 * Steps:
 * 1. Find the pole closest to the DT. This becomes the MST root.
 * 2. Grow the tree using Prim's algorithm.
 * 3. Enforce MAX_DEGREE: a pole can have at most MAX_DEGREE children.
 * 4. Ambiguity check: if a pole could have been connected to a second-best
 *    parent with a distance <= 1.15x the chosen parent's distance, flag the
 *    edge as ambiguous=true.
 * 5. Tag all edges as 'INFERRED'.
 *
 * @param {Object[]} poles - Array of registry poles for this DT
 * @param {Object} dt - The Transformer object
 * @returns {{ edges: Object[], valid: boolean, errors: string[] }}
 */
export function buildInferredTree(poles, dt) {
  if (!poles || poles.length === 0) {
    return { edges: [], valid: false, errors: [`DT ${dt.id}: no poles provided`] };
  }

  // Ensure all poles belong to this DT
  for (const p of poles) {
    if (p.dt_id !== dt.id) {
      return {
        edges: [],
        valid: false,
        errors: [`Pole ${p.id} belongs to DT ${p.dt_id}, not ${dt.id}`],
      };
    }
  }

  if (poles.length === 1) {
    // Only one pole, it's the root, no edges.
    return { edges: [], valid: true, errors: [] };
  }

  // 1. Find the root (pole closest to the DT)
  let rootPole = poles[0];
  let minDtDist = Infinity;
  for (const p of poles) {
    const d = haversine(dt.lat, dt.lon, p.lat, p.lon);
    if (d < minDtDist) {
      minDtDist = d;
      rootPole = p;
    }
  }

  const visited = new Set([rootPole.id]);
  const unvisited = new Set(poles.map((p) => p.id));
  unvisited.delete(rootPole.id);

  const poleById = new Map(poles.map((p) => [p.id, p]));
  const childCount = new Map(poles.map((p) => [p.id, 0]));
  const edges = [];

  // 2. Prim's Algorithm with degree constraint and ambiguity check
  while (unvisited.size > 0) {
    let bestEdge = null;
    let secondBestWeightForBestV = Infinity;

    for (const vId of unvisited) {
      const v = poleById.get(vId);
      
      let bestParentForV = null;
      let w1 = Infinity; // Best weight
      let w2 = Infinity; // Second best weight

      for (const uId of visited) {
        if (childCount.get(uId) >= MAX_DEGREE) continue;

        const u = poleById.get(uId);
        const d = haversine(u.lat, u.lon, v.lat, v.lon);

        if (d < w1) {
          w2 = w1;
          w1 = d;
          bestParentForV = u;
        } else if (d < w2) {
          w2 = d;
        }
      }

      if (bestParentForV) {
        if (!bestEdge || w1 < bestEdge.weight) {
          bestEdge = {
            parent: bestParentForV,
            child: v,
            weight: w1,
          };
          secondBestWeightForBestV = w2;
        }
      }
    }

    if (!bestEdge) {
      // In a fully connected graph with geometric distance and MAX_DEGREE >= 2,
      // it is mathematically impossible to run out of capacity unless there's a bug.
      return {
        edges: [],
        valid: false,
        errors: [`DT ${dt.id}: MST stalled. Tree capacity exhausted.`],
      };
    }

    const ambiguous = secondBestWeightForBestV <= bestEdge.weight * (1 + AMBIGUITY_TOLERANCE);

    edges.push({
      parent_pole_id: bestEdge.parent.id,
      child_pole_id: bestEdge.child.id,
      source: 'INFERRED',
      weight: Number(bestEdge.weight.toFixed(2)),
      ambiguous,
    });

    visited.add(bestEdge.child.id);
    unvisited.delete(bestEdge.child.id);
    childCount.set(bestEdge.parent.id, childCount.get(bestEdge.parent.id) + 1);
  }

  return { edges, valid: true, errors: [] };
}

/**
 * Builds inferred trees for all MISSING-topology DTs.
 *
 * Filters to only MISSING DTs; silently skips RECORDED-topology DTs (they are
 * handled by the authoritative module in Step 7).
 *
 * @param {object[]} transformers All registry Transformer records
 * @param {object[]} poles All registry Pole records
 * @returns {{ edges: Object[], dtResults: Map<string, Object> }}
 */
export function buildAllInferredTrees(transformers, poles) {
  const polesByDt = new Map();
  for (const p of poles) {
    if (!polesByDt.has(p.dt_id)) polesByDt.set(p.dt_id, []);
    polesByDt.get(p.dt_id).push(p);
  }

  const allEdges = [];
  const dtResults = new Map();

  for (const dt of transformers) {
    if (dt.topology_source !== 'MISSING') continue;

    const dtPoles = polesByDt.get(dt.id) || [];
    const result = buildInferredTree(dtPoles, dt);
    dtResults.set(dt.id, result);

    if (result.valid) {
      allEdges.push(...result.edges);
    }
  }

  return { edges: allEdges, dtResults };
}
