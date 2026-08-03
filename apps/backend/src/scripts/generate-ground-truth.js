/**
 * @file generate-ground-truth.js
 * Generates synthetic ground-truth radial electrical network topology (Feeders, DTs, Poles, Devices).
 */

const DEFAULT_CONFIG = {
  feederCount: 5,
  dtCount: 35,
  targetPoleCount: 4000,
  centerLat: 12.9716,
  centerLon: 77.5946,
  noDeviceRatio: 0.09,      // ~9% no device attached
  fw12Ratio: 0.08,          // ~8% devices on fw < 1.3
  missingPincodeRatio: 0.03,// ~3% missing pincodes
  authoritativeDtRatio: 0.40 // ~40% DTs recorded topology
};

/**
 * Generate distance offset in degrees (approx 111,000 meters per degree)
 * @param {number} meters 
 * @returns {number}
 */
function metersToDegrees(meters) {
  return meters / 111000;
}

/**
 * Generates the complete synthetic ground-truth radial network.
 * @param {Object} [config] 
 */
export function generateGroundTruthNetwork(config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const feeders = [];
  const transformers = [];
  const poles = [];
  const devices = [];

  // 1. Create Feeders
  for (let i = 1; i <= cfg.feederCount; i++) {
    feeders.push({
      id: `feeder-${i}`,
      name: `Feeder Line ${i}`,
    });
  }

  // 2. Distribute DTs across Feeders
  const dtsPerFeeder = Math.ceil(cfg.dtCount / cfg.feederCount);
  let dtCounter = 1;

  for (let fIdx = 0; fIdx < feeders.length; fIdx++) {
    const feeder = feeders[fIdx];
    const feederAngle = (fIdx / cfg.feederCount) * 2 * Math.PI;

    for (let d = 0; d < dtsPerFeeder && dtCounter <= cfg.dtCount; d++) {
      const dtId = `dt-${dtCounter}`;
      const dtAngle = feederAngle + (Math.random() - 0.5) * 0.3;
      const dtDistanceMeters = 500 + d * 800 + Math.random() * 200;

      const dtLat = cfg.centerLat + metersToDegrees(dtDistanceMeters * Math.cos(dtAngle));
      const dtLon = cfg.centerLon + metersToDegrees(dtDistanceMeters * Math.sin(dtAngle));

      const isAuthoritative = (dtCounter / cfg.dtCount) <= cfg.authoritativeDtRatio;

      transformers.push({
        id: dtId,
        feeder_id: feeder.id,
        lat: Number(dtLat.toFixed(6)),
        lon: Number(dtLon.toFixed(6)),
        capacity_kva: [100, 250, 500][Math.floor(Math.random() * 3)],
        households_served: Math.floor(40 + Math.random() * 80),
        topology_source: isAuthoritative ? 'AUTHORITATIVE' : 'INFERRED',
      });

      dtCounter++;
    }
  }

  // 3. Distribute Poles across DTs
  const polesPerDt = Math.floor(cfg.targetPoleCount / transformers.length);
  let poleCounter = 1;
  let deviceCounter = 1;

  for (const dt of transformers) {
    const dtPoles = [];
    const queue = [];

    // Root pole connected to DT
    const rootPoleId = `pole-${poleCounter++}`;
    const rootLat = dt.lat + metersToDegrees(20 + Math.random() * 10);
    const rootLon = dt.lon + metersToDegrees(20 + Math.random() * 10);

    const rootPole = {
      id: rootPoleId,
      dt_id: dt.id,
      feeder_id: dt.feeder_id,
      lat: Number(rootLat.toFixed(6)),
      lon: Number(rootLon.toFixed(6)),
      seq_on_line: 1,
      parent_pole_id: null,
      ward: `Ward ${Math.floor(1 + Math.random() * 10)}`,
      pincode: Math.random() < cfg.missingPincodeRatio ? null : '560001',
      device_id: null,
    };

    dtPoles.push(rootPole);
    queue.push(rootPole);

    // Build radial tree with branching factor 1 to 5
    while (dtPoles.length < polesPerDt && queue.length > 0) {
      const parent = queue.shift();
      const branchCount = Math.min(
        Math.floor(1 + Math.random() * 5),
        polesPerDt - dtPoles.length
      );

      const baseAngle = Math.atan2(parent.lon - dt.lon, parent.lat - dt.lat);

      for (let b = 0; b < branchCount; b++) {
        const childPoleId = `pole-${poleCounter++}`;
        const spreadAngle = baseAngle + (b - (branchCount - 1) / 2) * 0.4 + (Math.random() - 0.5) * 0.1;
        const stepDistance = 25 + Math.random() * 25; // 25-50 meters between poles

        const childLat = parent.lat + metersToDegrees(stepDistance * Math.cos(spreadAngle));
        const childLon = parent.lon + metersToDegrees(stepDistance * Math.sin(spreadAngle));

        const pincode = Math.random() < cfg.missingPincodeRatio ? null : '560001';

        const childPole = {
          id: childPoleId,
          dt_id: dt.id,
          feeder_id: dt.feeder_id,
          lat: Number(childLat.toFixed(6)),
          lon: Number(childLon.toFixed(6)),
          seq_on_line: (parent.seq_on_line || 1) + 1,
          parent_pole_id: parent.id,
          ward: parent.ward,
          pincode: pincode,
          device_id: null,
        };

        dtPoles.push(childPole);
        queue.push(childPole);
      }
    }

    // Attach Devices to ~91% of poles under this DT
    for (const p of dtPoles) {
      if (Math.random() >= cfg.noDeviceRatio) {
        const devId = `dev-${deviceCounter++}`;
        const isFw12 = Math.random() < cfg.fw12Ratio;
        const fwVersion = isFw12 ? '1.2.4' : '1.3.2';
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
 * Validates that every pole in the network forms a strict valid radial tree per DT (no cycles, single root path).
 * @param {Object} network 
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateTreeStructure(network) {
  const errors = [];
  const { transformers, poles } = network;

  const polesByDt = new Map();

  for (const p of poles) {
    if (!polesByDt.has(p.dt_id)) {
      polesByDt.set(p.dt_id, []);
    }
    polesByDt.get(p.dt_id).push(p);
  }

  for (const dt of transformers) {
    const dtPoles = polesByDt.get(dt.id) || [];
    if (dtPoles.length === 0) {
      errors.push(`DT ${dt.id} has 0 poles`);
      continue;
    }

    const roots = dtPoles.filter((p) => p.parent_pole_id === null);
    if (roots.length !== 1) {
      errors.push(`DT ${dt.id} must have exactly 1 root pole, found ${roots.length}`);
      continue;
    }

    // DFS check for cycle & reachability
    const visited = new Set();
    const stack = [roots[0].id];

    // Build parent-to-children adjacency map
    const childrenMap = new Map();
    for (const p of dtPoles) {
      if (p.parent_pole_id) {
        if (!childrenMap.has(p.parent_pole_id)) {
          childrenMap.set(p.parent_pole_id, []);
        }
        childrenMap.get(p.parent_pole_id).push(p.id);
      }
    }

    while (stack.length > 0) {
      const currId = stack.pop();

      if (visited.has(currId)) {
        errors.push(`Cycle detected in DT ${dt.id} involving pole ${currId}`);
        break;
      }

      visited.add(currId);
      const children = childrenMap.get(currId) || [];
      for (const childId of children) {
        stack.push(childId);
      }
    }

    if (visited.size !== dtPoles.length) {
      errors.push(`Unreachable poles in DT ${dt.id}: visited ${visited.size}/${dtPoles.length}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// Standalone execution script
if (process.argv[1]?.endsWith('generate-ground-truth.js')) {
  const network = generateGroundTruthNetwork();
  const validation = validateTreeStructure(network);
  console.log(`Generated network stats:`);
  console.log(`- Feeders: ${network.feeders.length}`);
  console.log(`- Transformers (DTs): ${network.transformers.length}`);
  console.log(`- Poles: ${network.poles.length}`);
  console.log(`- Devices: ${network.devices.length}`);
  console.log(`- Tree Structure Valid: ${validation.valid}`);
  if (!validation.valid) {
    console.error('Validation errors:', validation.errors);
    process.exit(1);
  }
}
