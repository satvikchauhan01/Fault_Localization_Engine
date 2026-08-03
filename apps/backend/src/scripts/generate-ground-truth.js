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
};

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

/**
 * Generates the complete synthetic ground-truth radial network.
 *
 * @param {Partial<typeof DEFAULT_CONFIG>} [config]
 * @returns {{ feeders: object[], transformers: object[], poles: object[], devices: object[] }}
 */
export function generateGroundTruthNetwork(config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const rand = seededRandom(cfg.seed != null ? cfg.seed : Date.now() & 0xffffffff);

  const feeders = [];
  const transformers = [];
  const poles = [];
  const devices = [];

  // ── 1. Create Feeders ──────────────────────────────────────────────────────
  for (let i = 1; i <= cfg.feederCount; i++) {
    feeders.push({ id: `feeder-${i}`, name: `Feeder Line ${i}` });
  }

  // ── 2. Distribute DTs across Feeders ───────────────────────────────────────
  const dtsPerFeeder = Math.ceil(cfg.dtCount / cfg.feederCount);
  let dtCounter = 1;
  let dtIndexForRecorded = 0; // deterministic round-robin for topology labelling

  for (let fIdx = 0; fIdx < feeders.length; fIdx++) {
    const feeder = feeders[fIdx];
    // Each feeder radiates in a different compass direction from city center
    const feederAngle = (fIdx / cfg.feederCount) * 2 * Math.PI;

    for (let d = 0; d < dtsPerFeeder && dtCounter <= cfg.dtCount; d++) {
      const dtId = `dt-${dtCounter}`;
      // Small angular jitter so DTs don't stack on an exact radial
      const dtAngle = feederAngle + (rand() - 0.5) * 0.3;
      // DTs sit 0.5–7 km from city center, spaced ~800 m along feeder
      const dtDistanceMeters = 500 + d * 800 + rand() * 200;

      const dtLat = cfg.centerLat + metersToLatDegrees(dtDistanceMeters * Math.cos(dtAngle));
      const dtLon = cfg.centerLon + metersToLonDegrees(dtDistanceMeters * Math.sin(dtAngle), cfg.centerLat);

      /**
       * 'RECORDED': department has authoritative topology on file; registry will
       *   expose parent_pole_id for this DT's poles.
       * 'MISSING': no topology on file; registry export (Step 5) will null out
       *   parent_pole_id so the localization engine cannot see it.
       * 'INFERRED' is NOT a ground-truth label — it is assigned by the runtime
       *   Topology Service (Step 8) after it runs MST inference.
       */
      const isRecorded = dtIndexForRecorded < Math.round(cfg.dtCount * cfg.recordedTopologyRatio);
      const topology_source = isRecorded ? 'RECORDED' : 'MISSING';

      transformers.push({
        id: dtId,
        feeder_id: feeder.id,
        lat: Number(dtLat.toFixed(6)),
        lon: Number(dtLon.toFixed(6)),
        capacity_kva: [100, 250, 500][Math.floor(rand() * 3)],
        households_served: Math.floor(40 + rand() * 80),
        topology_source,
      });

      dtCounter++;
      dtIndexForRecorded++;
    }
  }

  // ── 3. Generate Poles for each DT ──────────────────────────────────────────
  const polesPerDt = Math.floor(cfg.targetPoleCount / transformers.length);
  let poleCounter = 1;
  let deviceCounter = 1;

  for (const dt of transformers) {
    const dtPoles = [];

    // ── 3a. Root pole (adjacent to DT, always seq=1, no parent) ──
    const rootPoleId = `pole-${poleCounter++}`;
    // Root is placed ~20-30 m from DT in a random direction
    const rootAngle = rand() * 2 * Math.PI;
    const rootDistM = 20 + rand() * 10;
    const rootLat = dt.lat + metersToLatDegrees(rootDistM * Math.cos(rootAngle));
    const rootLon = dt.lon + metersToLonDegrees(rootDistM * Math.sin(rootAngle), dt.lat);

    dtPoles.push({
      id: rootPoleId,
      dt_id: dt.id,
      feeder_id: dt.feeder_id,
      lat: Number(rootLat.toFixed(6)),
      lon: Number(rootLon.toFixed(6)),
      seq_on_line: 1,
      parent_pole_id: null, // root of DT subtree
      ward: `Ward ${Math.floor(1 + rand() * 10)}`,
      pincode: rand() < cfg.missingPincodeRatio ? null : '560001',
      device_id: null,
    });

    // ── 3b. Grow tree via BFS, controlled branching ──────────────────────────
    // Queue holds indices into dtPoles (not objects) to avoid reference drift.
    const queue = [0];

    while (dtPoles.length < polesPerDt && queue.length > 0) {
      const parentIdx = queue.shift();
      const parent = dtPoles[parentIdx];
      const remaining = polesPerDt - dtPoles.length;

      /**
       * Branching control: depth-1 nodes (root's direct children) may branch
       * 1–4. All deeper nodes are mostly chains (1 child), occasionally 2.
       * This avoids the "aggressively bushy" problem described in the review.
       */
      const isNearRoot = parent.seq_on_line <= 2;
      const maxBranch = isNearRoot ? 4 : 2;
      const branchCount = Math.min(Math.floor(1 + rand() * maxBranch), remaining);

      // Determine base propagation direction from DT→parent vector
      const dLat = parent.lat - dt.lat;
      const dLon = parent.lon - dt.lon;
      const baseAngle = Math.atan2(dLon, dLat);

      for (let b = 0; b < branchCount; b++) {
        const childPoleId = `pole-${poleCounter++}`;
        // Spread branches symmetrically, with small random jitter
        const spreadAngle =
          baseAngle +
          (branchCount > 1 ? ((b - (branchCount - 1) / 2) * 0.35) : 0) +
          (rand() - 0.5) * 0.1;

        // 25–50 m per pole span — realistic LT line spacing
        const stepM = 25 + rand() * 25;
        const childLat = parent.lat + metersToLatDegrees(stepM * Math.cos(spreadAngle));
        const childLon = parent.lon + metersToLonDegrees(stepM * Math.sin(spreadAngle), parent.lat);

        const childIdx = dtPoles.length;
        dtPoles.push({
          id: childPoleId,
          dt_id: dt.id,
          feeder_id: dt.feeder_id,
          lat: Number(childLat.toFixed(6)),
          lon: Number(childLon.toFixed(6)),
          seq_on_line: parent.seq_on_line + 1,
          parent_pole_id: parent.id, // GROUND-TRUTH physical parent; stripped for MISSING-topology DTs in Step 5
          ward: parent.ward,
          pincode: rand() < cfg.missingPincodeRatio ? null : '560001',
          device_id: null,
        });

        queue.push(childIdx);
      }
    }

    // ── 3c. Attach devices and push to global poles array ────────────────────
    for (const p of dtPoles) {
      if (rand() >= cfg.noDeviceRatio) {
        const devId = `dev-${deviceCounter++}`;
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
  }

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


