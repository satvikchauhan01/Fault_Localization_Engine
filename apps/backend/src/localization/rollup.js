/**
 * @file rollup.js
 *
 * Localization Engine — DT and Feeder Rollup (Section H, Rules 5 & 6)
 *
 * This module is PURE: no DB access, no side effects.
 *
 * Rule 5 — DT Rollup:
 *   If ≥90% of *monitored* poles under a DT are CONFIRMED_DARK, and no LIVE
 *   pole is observed under that DT, emit a single DT_FAULT incident. This
 *   supersedes all span-level frontier edges for that DT.
 *
 * Rule 6 — Feeder Rollup:
 *   Same ≥90% threshold applied across all DTs on a feeder. If the threshold
 *   is met at the feeder level, emit a FEEDER_FAULT incident. DT-level
 *   incidents are kept as records but must NOT be surfaced as separate active
 *   tickets — they are nested under the feeder incident.
 *
 * Section C thresholds (from master plan, will be extracted to shared
 * thresholds.js at Step 16 — kept inline here with clear comments):
 *   - ROLLUP_THRESHOLD = 0.90  (90%)
 *   - CORRELATION_WINDOW_MS = 5 * 60 * 1000  (5 minutes)
 *
 * Note: "monitored poles" = poles with a device_id (the ~91% with devices).
 * Unmonitored poles (~9%) are excluded from both the numerator and denominator
 * of the threshold calculation — we cannot observe their state.
 */

/** Fraction of monitored poles that must be dark to trigger a rollup */
const ROLLUP_THRESHOLD = 0.90;

/** Correlation window in ms: "roughly simultaneous" = within 5 minutes */
const CORRELATION_WINDOW_MS = 5 * 60 * 1000;

/**
 * @typedef {Object} RollupResult
 * @property {'DT_FAULT'|'FEEDER_FAULT'} type
 * @property {string}   target_id        DT id (for DT_FAULT) or feeder id (for FEEDER_FAULT)
 * @property {string[]} affected_pole_ids All dark monitored poles contributing to this rollup
 * @property {number}   dark_count        Number of dark monitored poles
 * @property {number}   monitored_count   Total monitored poles in scope
 * @property {number}   dark_ratio        dark_count / monitored_count
 * @property {boolean}  has_live_pole     True if any monitored pole in scope is LIVE
 */

/**
 * Evaluates whether a single DT qualifies for a DT_FAULT rollup.
 *
 * @param {string}                         dtId
 * @param {string[]}                       poleMemberIds   All pole IDs belonging to this DT
 * @param {Map<string,{status:string}>}    poleStates      Current observed pole states
 * @param {Map<string,{device_id:string}>} poleMap         Registry pole metadata
 * @param {number}                         [windowMs]      Optional override for correlation window
 * @returns {RollupResult|null}  null if threshold not met
 */
export function evaluateDtRollup(dtId, poleMemberIds, poleStates, poleMap, _windowMs = CORRELATION_WINDOW_MS) {
  // Partition poles into monitored (has device) vs unmonitored
  const monitoredPoleIds = poleMemberIds.filter((id) => {
    const pole = poleMap.get(id);
    return pole && pole.device_id !== null;
  });

  if (monitoredPoleIds.length === 0) {
    // No monitored poles — can't determine state, no rollup
    return null;
  }

  let darkCount = 0;
  let hasLivePole = false;
  const darkPoleIds = [];

  for (const id of monitoredPoleIds) {
    const state = poleStates.get(id);
    const status = state ? state.status : null;

    if (status === 'CONFIRMED_DARK') {
      darkCount++;
      darkPoleIds.push(id);
    } else if (status === 'LIVE') {
      hasLivePole = true;
    }
  }

  const darkRatio = darkCount / monitoredPoleIds.length;

  // Rule 5: ≥90% dark AND no LIVE pole observed
  if (darkRatio >= ROLLUP_THRESHOLD && !hasLivePole) {
    return {
      type: 'DT_FAULT',
      target_id: dtId,
      affected_pole_ids: darkPoleIds,
      dark_count: darkCount,
      monitored_count: monitoredPoleIds.length,
      dark_ratio: darkRatio,
      has_live_pole: false,
    };
  }

  return null;
}

/**
 * Evaluates whether a feeder qualifies for a FEEDER_FAULT rollup.
 *
 * A feeder rollup requires ≥90% of ALL monitored poles across ALL DTs
 * on the feeder to be CONFIRMED_DARK, with no LIVE pole on any DT.
 *
 * @param {string}                         feederId
 * @param {string[]}                       dtIds           All DT IDs on this feeder
 * @param {Map<string,string[]>}           dtPoleMap       dtId → pole IDs for that DT
 * @param {Map<string,{status:string}>}    poleStates
 * @param {Map<string,{device_id:string}>} poleMap
 * @returns {{ feederRollup: RollupResult|null, dtRollups: Map<string, RollupResult|null> }}
 */
export function evaluateFeederRollup(feederId, dtIds, dtPoleMap, poleStates, poleMap) {
  // First evaluate each DT individually (needed for nesting/records)
  const dtRollups = new Map();
  for (const dtId of dtIds) {
    const poleIds = dtPoleMap.get(dtId) || [];
    const dtResult = evaluateDtRollup(dtId, poleIds, poleStates, poleMap);
    dtRollups.set(dtId, dtResult);
  }

  // Now evaluate the feeder as a whole — aggregate all monitored poles
  let totalMonitored = 0;
  let totalDark = 0;
  let feederHasLive = false;
  const allDarkPoleIds = [];

  for (const dtId of dtIds) {
    const poleIds = dtPoleMap.get(dtId) || [];

    for (const id of poleIds) {
      const pole = poleMap.get(id);
      if (!pole || pole.device_id === null) continue; // unmonitored — skip

      totalMonitored++;
      const state = poleStates.get(id);
      const status = state ? state.status : null;

      if (status === 'CONFIRMED_DARK') {
        totalDark++;
        allDarkPoleIds.push(id);
      } else if (status === 'LIVE') {
        feederHasLive = true;
      }
    }
  }

  if (totalMonitored === 0) {
    return { feederRollup: null, dtRollups };
  }

  const feederDarkRatio = totalDark / totalMonitored;

  // Rule 6: ≥90% of all monitored poles on the feeder are dark, no LIVE pole anywhere
  if (feederDarkRatio >= ROLLUP_THRESHOLD && !feederHasLive) {
    const feederRollup = {
      type: 'FEEDER_FAULT',
      target_id: feederId,
      affected_pole_ids: allDarkPoleIds,
      dark_count: totalDark,
      monitored_count: totalMonitored,
      dark_ratio: feederDarkRatio,
      has_live_pole: false,
    };
    return { feederRollup, dtRollups };
  }

  return { feederRollup: null, dtRollups };
}

/**
 * Determines which incidents to surface after applying rollup logic.
 *
 * Given span-level frontier edges and rollup results for each DT, this function
 * decides what to expose to the operator:
 *
 * - If a FEEDER_FAULT fires: return that alone; DT incidents become nested records.
 * - If a DT_FAULT fires: return that; span-level frontier edges for that DT are suppressed.
 * - Otherwise: return the span-level frontier edges as-is.
 *
 * @param {object[]}                       frontierEdges   From detectFrontier()
 * @param {Map<string, RollupResult|null>} dtRollups       DT rollup results keyed by dt_id
 * @param {RollupResult|null}              feederRollup    Feeder rollup result (or null)
 * @param {Map<string, string>}            poleIdToDtId    Maps each pole_id to its dt_id
 * @returns {{
 *   incidents: object[],
 *   suppressedFrontierEdges: object[],
 *   nestedDtIncidents: RollupResult[]
 * }}
 */
export function applyRollup(frontierEdges, dtRollups, feederRollup, poleIdToDtId) {
  // FEEDER_FAULT: suppress everything, nest DT incidents as records
  if (feederRollup) {
    const nestedDtIncidents = [];
    for (const [, dtResult] of dtRollups) {
      if (dtResult) nestedDtIncidents.push(dtResult);
    }
    return {
      incidents: [feederRollup],
      suppressedFrontierEdges: frontierEdges,
      nestedDtIncidents,
    };
  }

  // Per-DT: check which span frontiers are superseded by a DT_FAULT
  const suppressedEdges = [];
  const remainingEdges = [];

  for (const edge of frontierEdges) {
    // Map the child pole (the dark side) to its DT
    const dtId = poleIdToDtId.get(edge.child_pole_id);
    const dtRollup = dtId ? dtRollups.get(dtId) : null;

    if (dtRollup) {
      // This span edge falls inside a DT that has rolled up — suppress it
      suppressedEdges.push(edge);
    } else {
      remainingEdges.push(edge);
    }
  }

  // Collect DT_FAULT incidents
  const dtIncidents = [];
  for (const [, dtResult] of dtRollups) {
    if (dtResult) dtIncidents.push(dtResult);
  }

  return {
    incidents: [...remainingEdges, ...dtIncidents],
    suppressedFrontierEdges: suppressedEdges,
    nestedDtIncidents: [],
  };
}
