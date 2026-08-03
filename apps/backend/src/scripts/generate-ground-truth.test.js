import { describe, it, expect } from 'vitest';
import { generateGroundTruthNetwork, validateTreeStructure } from './generate-ground-truth.js';

describe('Synthetic Ground-Truth Topology Generator', () => {
  it('generates a valid radial network within target bounds', () => {
    const network = generateGroundTruthNetwork({
      feederCount: 5,
      dtCount: 35,
      targetPoleCount: 4000,
    });

    // 1. Bounds assertions
    expect(network.feeders.length).toBeGreaterThanOrEqual(4);
    expect(network.feeders.length).toBeLessThanOrEqual(6);

    expect(network.transformers.length).toBeGreaterThanOrEqual(30);
    expect(network.transformers.length).toBeLessThanOrEqual(40);

    expect(network.poles.length).toBeGreaterThanOrEqual(3000);
    expect(network.poles.length).toBeLessThanOrEqual(5000);

    // 2. Tree structural integrity assertion (acyclic + single root reachability)
    const validation = validateTreeStructure(network);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);

    // 3. Attribute proportions assertions
    const unmonitoredPoles = network.poles.filter((p) => p.device_id === null);
    const unmonitoredRatio = unmonitoredPoles.length / network.poles.length;
    expect(unmonitoredRatio).toBeGreaterThan(0.05);
    expect(unmonitoredRatio).toBeLessThan(0.15);

    const fw12Devices = network.devices.filter((d) => d.fw_version.startsWith('1.2'));
    const fw12Ratio = fw12Devices.length / network.devices.length;
    expect(fw12Ratio).toBeGreaterThan(0.04);
    expect(fw12Ratio).toBeLessThan(0.12);

    const missingPincodePoles = network.poles.filter((p) => p.pincode === null);
    const missingPincodeRatio = missingPincodePoles.length / network.poles.length;
    expect(missingPincodeRatio).toBeGreaterThan(0.01);
    expect(missingPincodeRatio).toBeLessThan(0.06);
  });
});
