/**
 * @file generate-ground-truth.js
 *
 * Generates synthetic ground-truth radial electrical network topology.
 *
 * KEY DESIGN BOUNDARY:
 *   - `topology_source` on Transformer is the GROUND-TRUTH label: either
 *     'RECORDED' (authoritative, registry will expose parent_pole_id) or
 *     'MISSING' (no recorded topology; parent_pole_id will be nulled by the
 *     registry export in Step 5). The value 'INFERRED' is NEVER produced here —
 *     inference is something the Topology Service computes at runtime from
 *     GPS coordinates, and belongs only in Step 8.
 *   - `parent_pole_id` on each Pole is GROUND-TRUTH physical adjacency. For
 *     MISSING-topology DTs it will be stripped by the registry export so the
 *     localization engine cannot read it. Never query ground-truth tables from
 *     localization or topology code.
 */



/**
 * Minimal seeded pseudo-random number generator (Mulberry32).
 * Returns a factory function `() => number in [0, 1)` given a 32-bit integer seed.
 * Reproducible output lets tests avoid flakiness without mocking Math.random.
 * @param {number} seed
 * @returns {() => number}
 */
export function seededRandom(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEFAULT_CONFIG = {
  feederCount: 5,
  dtCount: 35,
  targetPoleCount: 4000,
  // Bangalore city center
  centerLat: 12.9716,
  centerLon: 77.5946,
  noDeviceRatio: 0.09,       // ~9% poles have no IoT device
  fw12Ratio: 0.08,           // ~8% devices run firmware < 1.3 (silent on outage)
  missingPincodeRatio: 0.03, // ~3% poles have missing PIN code
  /**
   * ~40% of DTs have RECORDED topology (parent_pole_id populated in registry).
   * The remaining ~60% have MISSING topology (parent_pole_id stripped in registry).
   * These labels describe what the department has on file — NOT what the engine
   * has inferred. The value 'INFERRED' is never set here.
   */
  recordedTopologyRatio: 0.40,
  /**
   * Seed for the pseudo-random generator. Set explicitly for reproducible tests.
   * Default null means truly random (uses Date.now()).
   */
  seed: null,

  substationName: 'Central 66/11 kV Substation',
  // Layout, in metres. Feeders leave the substation along gently bending roads;
  // DTs are tapped along them; each DT's LT network runs along a street grid.
  firstDtDistanceM: 900,
  dtSpacingM: 700,
  feederBendMaxDeg: 8,
  feederTailM: 250,
  spanM: 38,              // LT pole-to-pole span
  blockSpans: 3,          // a street every 3 spans, so ~114 m city blocks
  ltOffsetM: 18,          // first LT pole sits across the road from its DT
  ltHalfAlongSpans: 8,    // keeps a DT's network clear of its neighbours on the feeder
  ltHalfAcrossSpans: 12,
  missingStreetRatio: 0.12, // side streets with no LT line at all
  poleJitterM: 3,
  minPoleSeparationM: 20, // no pole of one DT this close to another DT's pole
};

// Real central-Bengaluru PIN codes, assigned by ward to keep areas coherent.
const PINCODES = ['560001', '560002', '560004', '560009', '560025', '560027', '560042', '560046', '560051', '560052'];

/**
 * Convert meters to latitude degrees (111,000 m ≈ 1°).
 * @param {number} meters
 * @returns {number}
 */
function metersToLatDegrees(meters) {
  return meters / 111000;
}

/**
 * Convert meters to longitude degrees, accounting for latitude compression.
 * @param {number} meters
 * @param {number} latDegrees  Current latitude in degrees
 * @returns {number}
 */
function metersToLonDegrees(meters, latDegrees) {
  const latRad = (latDegrees * Math.PI) / 180;
  return meters / (111000 * Math.cos(latRad));
}

function round6(x) {
  return Number(x.toFixed(6));
}

/** Offsets a lat/lon by `north` / `east` metres. */
function offset(lat, lon, north, east) {
  return [lat + metersToLatDegrees(north), lon + metersToLonDegrees(east, lat)];
}

function mod(n, m) {
  return ((n % m) + m) % m;
}

/**
 * Buckets poles into square cells so "is another DT's pole within N metres?"
 * only has to look at the 3x3 cells around a point.
 */
function createSpatialHash(cellM, refLat) {
  const mPerLat = 111000;
  const mPerLon = 111000 * Math.cos((refLat * Math.PI) / 180);
  const cells = new Map();
  const cellKey = (cx, cy) => `${cx}:${cy}`;
  const toXY = (lat, lon) => [lat * mPerLat, lon * mPerLon];

  return {
    add(lat, lon, owner) {
      const [x, y] = toXY(lat, lon);
      const k = cellKey(Math.floor(x / cellM), Math.floor(y / cellM));
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push({ x, y, owner });
    },
    hasForeignWithin(lat, lon, owner, distM) {
      const [x, y] = toXY(lat, lon);
      const cx = Math.floor(x / cellM);
      const cy = Math.floor(y / cellM);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const p of cells.get(cellKey(cx + dx, cy + dy)) || []) {
            if (p.owner !== owner && Math.hypot(p.x - x, p.y - y) < distM) return true;
          }
        }
      }
      return false;
    },
  };
}

/**
 * Generates the complete synthetic ground-truth radial network.
 *
 * Layout: one substation; each feeder leaves it along a gently bending road
 * with its DTs tapped along the way; each DT feeds an LT network that runs
 * along a street grid (straight runs of poles, branching only at street
 * intersections), grown outward from a root pole beside the DT.
 *
 * @param {Partial<typeof DEFAULT_CONFIG>} [config]
 * @returns {{ feeders: object[], transformers: object[], poles: object[], devices: object[] }}
 */
export function generateGroundTruthNetwork(config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const rand = seededRandom(cfg.seed != null ? cfg.seed : Date.now() & 0xffffffff);
  const between = (lo, hi) => lo + rand() * (hi - lo);

  const feeders = [];
  const transformers = [];
  const poles = [];
  const devices = [];

  // ── 1. Feeders, and the DTs tapped along each one ───────────────────────────
  const substation = [cfg.centerLat, cfg.centerLon];
  const dtsPerFeeder = Math.ceil(cfg.dtCount / cfg.feederCount);
  const recordedDtCount = Math.round(cfg.dtCount * cfg.recordedTopologyRatio);
  const bendRad = (cfg.feederBendMaxDeg * Math.PI) / 180;
  const dtHeadings = [];
  let dtCounter = 1;

  for (let fIdx = 0; fIdx < cfg.feederCount; fIdx++) {
    const feederId = `feeder-${fIdx + 1}`;
    // Bearing clockwise from north; feeders fan out evenly around the substation.
    let heading = 0.35 + (fIdx / cfg.feederCount) * 2 * Math.PI;
    let [lat, lon] = substation;
    const route = [[round6(lat), round6(lon)]];

    for (let d = 0; d < dtsPerFeeder && dtCounter <= cfg.dtCount; d++) {
      let stepM = cfg.firstDtDistanceM;
      if (d > 0) {
        heading += between(-bendRad, bendRad);
        stepM = cfg.dtSpacingM * between(0.92, 1.08);
      }
      [lat, lon] = offset(lat, lon, stepM * Math.cos(heading), stepM * Math.sin(heading));
      route.push([round6(lat), round6(lon)]);

      /**
       * 'RECORDED': department has authoritative topology on file; registry will
       *   expose parent_pole_id for this DT's poles.
       * 'MISSING': no topology on file; registry export (Step 5) will null out
       *   parent_pole_id so the localization engine cannot see it.
       * 'INFERRED' is NOT a ground-truth label — it is assigned by the runtime
       *   Topology Service (Step 8) after it runs MST inference.
       */
      transformers.push({
        id: `dt-${dtCounter}`,
        feeder_id: feederId,
        lat: round6(lat),
        lon: round6(lon),
        capacity_kva: [100, 250, 500][Math.floor(rand() * 3)],
        households_served: Math.floor(40 + rand() * 80),
        topology_source: dtCounter <= recordedDtCount ? 'RECORDED' : 'MISSING',
      });
      dtHeadings.push(heading);
      dtCounter++;
    }

    const [tailLat, tailLon] = offset(lat, lon, cfg.feederTailM * Math.cos(heading), cfg.feederTailM * Math.sin(heading));
    route.push([round6(tailLat), round6(tailLon)]);

    feeders.push({
      id: feederId,
      name: `11 kV Feeder ${fIdx + 1}`,
      substation: cfg.substationName,
      route,
    });
  }

  // ── 2. LT network per DT, grown along a street grid ────────────────────────
  // Lattice in the DT's local frame (i along the feeder road, j across it). Only
  // street nodes hold poles, so lines run straight and branch at intersections.
  const polesPerDt = Math.floor(cfg.targetPoleCount / Math.max(transformers.length, 1));
  const occupied = createSpatialHash(cfg.minPoleSeparationM, cfg.centerLat);
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let poleCounter = 1;

  transformers.forEach((dt, dtIdx) => {
    const heading = dtHeadings[dtIdx];
    const wardIdx = Math.floor(dtIdx / 2);
    const ward = `Ward ${wardIdx + 1}`;
    const wardPincode = PINCODES[wardIdx % PINCODES.length];

    const toLatLon = (alongM, acrossM) => {
      const north = alongM * Math.cos(heading) - acrossM * Math.sin(heading);
      const east = alongM * Math.sin(heading) + acrossM * Math.cos(heading);
      return offset(dt.lat, dt.lon, north, east);
    };
    // Each side street gets its own extent (and a few get none), so neighbourhoods
    // differ; the two main streets through the root always run the full width.
    const streetSpan = (index, halfLen) => {
      if (index === 0) return [-halfLen, halfLen];
      if (rand() < cfg.missingStreetRatio) return null;
      return [-Math.round(halfLen * between(0.45, 1)), Math.round(halfLen * between(0.45, 1))];
    };
    const rowSpans = new Map();
    const colSpans = new Map();
    for (let j = -cfg.ltHalfAcrossSpans; j <= cfg.ltHalfAcrossSpans; j++) {
      if (mod(j, cfg.blockSpans) === 0) rowSpans.set(j, streetSpan(j, cfg.ltHalfAlongSpans));
    }
    for (let i = -cfg.ltHalfAlongSpans; i <= cfg.ltHalfAlongSpans; i++) {
      if (mod(i, cfg.blockSpans) === 0) colSpans.set(i, streetSpan(i, cfg.ltHalfAcrossSpans));
    }
    const within = (span, x) => span != null && x >= span[0] && x <= span[1];
    const onStreet = (i, j) => within(rowSpans.get(j), i) || within(colSpans.get(i), j);
    const inArea = (i, j) => Math.abs(i) <= cfg.ltHalfAlongSpans && Math.abs(j) <= cfg.ltHalfAcrossSpans;
    const nodeKey = (i, j) => `${i},${j}`;

    const dtPoles = [];
    const taken = new Set();
    const frontier = [];

    const place = (i, j, parent, dir, force) => {
      const jitter = () => between(-cfg.poleJitterM, cfg.poleJitterM);
      const [lat, lon] = toLatLon(i * cfg.spanM + jitter(), cfg.ltOffsetM + j * cfg.spanM + jitter());
      if (!force && occupied.hasForeignWithin(lat, lon, dt.id, cfg.minPoleSeparationM)) return false;

      const pole = {
        id: `pole-${poleCounter++}`,
        dt_id: dt.id,
        feeder_id: dt.feeder_id,
        lat: round6(lat),
        lon: round6(lon),
        seq_on_line: parent ? parent.seq_on_line + 1 : 1,
        parent_pole_id: parent ? parent.id : null, // GROUND-TRUTH physical parent; stripped for MISSING-topology DTs in Step 5
        ward,
        pincode: rand() < cfg.missingPincodeRatio ? null : wardPincode,
        device_id: null,
      };
      dtPoles.push(pole);
      occupied.add(lat, lon, dt.id);

      for (const [di, dj] of DIRS) {
        const ni = i + di;
        const nj = j + dj;
        if (!inArea(ni, nj) || !onStreet(ni, nj) || taken.has(nodeKey(ni, nj))) continue;
        const straight = dir !== null && dir[0] === di && dir[1] === dj;
        frontier.push({
          i: ni,
          j: nj,
          parent: pole,
          dir: [di, dj],
          score: pole.seq_on_line + (straight ? 0 : 0.6) + rand() * 2.5,
        });
      }
      return true;
    };

    taken.add(nodeKey(0, 0));
    place(0, 0, null, null, true);

    while (dtPoles.length < polesPerDt && frontier.length > 0) {
      let best = 0;
      for (let k = 1; k < frontier.length; k++) {
        if (frontier[k].score < frontier[best].score) best = k;
      }
      const cand = frontier.splice(best, 1)[0];
      const k = nodeKey(cand.i, cand.j);
      if (taken.has(k)) continue;
      taken.add(k); // placed, or blocked by a neighbouring DT's network
      place(cand.i, cand.j, cand.parent, cand.dir, false);
    }

    // ── 3. Attach devices and push to global poles array ────────────────────
    for (const p of dtPoles) {
      if (rand() >= cfg.noDeviceRatio) {
        const devId = `dev-${devices.length + 1}`;
        const fwVersion = rand() < cfg.fw12Ratio ? '1.2.4' : '1.3.2';
        const nowIso = new Date().toISOString();
        p.device_id = devId;
        devices.push({
          id: devId,
          pole_id: p.id,
          fw_version: fwVersion,
          first_seen: nowIso,
          last_seen: nowIso,
        });
      }
      poles.push(p);
    }
  });

  return { feeders, transformers, poles, devices };
}

/**
 * Validates that every pole forms a strict valid radial tree per DT.
 *
 * Checks:
 *  1. Exactly one root pole per DT (parent_pole_id === null).
 *  2. No duplicate pole IDs across the whole network.
 *  3. No self-referencing poles (parent_pole_id === id).
 *  4. No pole references a parent that belongs to a different DT.
 *  5. No pole references a non-existent parent ID.
 *  6. No cycles (DFS).
 *  7. All poles are reachable from the DT root (no orphans).
 *
 * @param {{ transformers: object[], poles: object[] }} network
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateTreeStructure(network) {
  const errors = [];
  const { transformers, poles } = network;

  // ── Check 2: no duplicate pole IDs ────────────────────────────────────────
  const allPoleIds = new Set();
  for (const p of poles) {
    if (allPoleIds.has(p.id)) {
      errors.push(`Duplicate pole ID: ${p.id}`);
    }
    allPoleIds.add(p.id);
  }

  // Index poles by ID and by DT
  const poleById = new Map(poles.map((p) => [p.id, p]));
  const polesByDt = new Map();
  for (const p of poles) {
    if (!polesByDt.has(p.dt_id)) polesByDt.set(p.dt_id, []);
    polesByDt.get(p.dt_id).push(p);
  }

  for (const dt of transformers) {
    const dtPoles = polesByDt.get(dt.id) || [];
    if (dtPoles.length === 0) {
      errors.push(`DT ${dt.id} has 0 poles`);
      continue;
    }

    for (const p of dtPoles) {
      // ── Check 3: self-referencing ──────────────────────────────────────────
      if (p.parent_pole_id === p.id) {
        errors.push(`Pole ${p.id} in DT ${dt.id} is its own parent (self-reference)`);
      }

      if (p.parent_pole_id !== null) {
        // ── Check 5: non-existent parent ────────────────────────────────────
        if (!poleById.has(p.parent_pole_id)) {
          errors.push(`Pole ${p.id} in DT ${dt.id} references non-existent parent ${p.parent_pole_id}`);
          continue;
        }
        // ── Check 4: parent belongs to different DT ──────────────────────────
        const parentPole = poleById.get(p.parent_pole_id);
        if (parentPole.dt_id !== dt.id) {
          errors.push(
            `Pole ${p.id} references parent ${p.parent_pole_id} which belongs to DT ${parentPole.dt_id}, not ${dt.id}`
          );
        }
      }
    }

    // ── Check 1: exactly one root ─────────────────────────────────────────────
    const roots = dtPoles.filter((p) => p.parent_pole_id === null);
    if (roots.length !== 1) {
      errors.push(`DT ${dt.id} must have exactly 1 root pole, found ${roots.length}`);
      continue;
    }

    // ── Build children map for DFS ─────────────────────────────────────────────
    const childrenMap = new Map();
    for (const p of dtPoles) {
      if (p.parent_pole_id) {
        if (!childrenMap.has(p.parent_pole_id)) childrenMap.set(p.parent_pole_id, []);
        childrenMap.get(p.parent_pole_id).push(p.id);
      }
    }

    // ── Checks 6 + 7: DFS for cycles and unreachable poles ────────────────────
    const visited = new Set();
    const stack = [roots[0].id];

    while (stack.length > 0) {
      const currId = stack.pop();
      if (visited.has(currId)) {
        errors.push(`Cycle detected in DT ${dt.id} involving pole ${currId}`);
        break;
      }
      visited.add(currId);
      for (const childId of childrenMap.get(currId) || []) {
        stack.push(childId);
      }
    }

    if (visited.size !== dtPoles.length) {
      const orphans = dtPoles.filter((p) => !visited.has(p.id)).map((p) => p.id);
      errors.push(
        `Orphan/unreachable poles in DT ${dt.id}: ${orphans.slice(0, 5).join(', ')}` +
          (orphans.length > 5 ? ` … (${orphans.length} total)` : '')
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Standalone CLI execution ──────────────────────────────────────────────────
// (Removed `createRequire` import — kept in header only for documentation)
if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].replace(/\\/g, '/').endsWith('scripts/generate-ground-truth.js')
) {
  const network = generateGroundTruthNetwork();
  const validation = validateTreeStructure(network);
  console.log('Generated network stats:');
  console.log(`  Feeders:          ${network.feeders.length}`);
  console.log(`  Transformers (DT):${network.transformers.length}`);
  console.log(`  Poles:            ${network.poles.length}`);
  console.log(`  Devices:          ${network.devices.length}`);

  const recorded = network.transformers.filter((t) => t.topology_source === 'RECORDED').length;
  const missing = network.transformers.filter((t) => t.topology_source === 'MISSING').length;
  console.log(`  DT topology — RECORDED: ${recorded} | MISSING: ${missing}`);
  console.log(`  Tree structure valid: ${validation.valid}`);

  if (!validation.valid) {
    console.error('Validation errors:', validation.errors);
    process.exit(1);
  }
}


