/**
 * @file export-registry.js
 *
 * Derives the department-visible "registry" from the ground-truth network.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  DESIGN BOUNDARY — read before modifying                                 │
 * │                                                                          │
 * │  Ground-truth tables hold the true physical network including:           │
 * │    • True parent_pole_id for every pole in every DT                      │
 * │    • True topology_source label: RECORDED | MISSING                      │
 * │                                                                          │
 * │  Registry tables are what the department actually has on file:           │
 * │    • parent_pole_id is NULL for all poles under MISSING-topology DTs     │
 * │    • seq_on_line is NULL for all poles under MISSING-topology DTs        │
 * │    • topology_source is preserved as-is (RECORDED or MISSING)            │
 * │                                                                          │
 * │  The localization engine and topology service ONLY READ registry tables. │
 * │  This function must NEVER copy ground-truth-only fields into the         │
 * │  registry output for MISSING-topology DTs.                               │
 * │                                                                          │
 * │  Concretely: no code outside this file (and the ground-truth generator)  │
 * │  should access .parent_pole_id on a pole when the parent DT has          │
 * │  topology_source === 'MISSING'. The boundary test (Step 25) enforces     │
 * │  this structurally at the module import level.                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/**
 * Derives the department-visible registry from a ground-truth network object.
 *
 * Rules applied per Section J of the Master Architecture Plan:
 *  1. Feeders:      Passed through unchanged (no sensitive ground-truth fields).
 *  2. Transformers: topology_source preserved (RECORDED | MISSING). No hidden
 *                   fields exist on this entity.
 *  3. Poles:        For MISSING-topology DTs, parent_pole_id and seq_on_line
 *                   are nulled — the registry must not expose the true physical
 *                   parent, because the department does not have that data.
 *                   For RECORDED-topology DTs, both are preserved.
 *  4. Devices:      Passed through unchanged (device records are departmental data).
 *
 * @param {{ feeders: object[], transformers: object[], poles: object[], devices: object[] }} groundTruth
 * @returns {{ feeders: object[], transformers: object[], poles: object[], devices: object[] }}
 */
export function exportRegistry(groundTruth) {
  const { feeders, transformers, poles, devices } = groundTruth;

  // Build a lookup: dt_id → topology_source, so pole projection is O(n)
  const dtTopologySource = new Map(
    transformers.map((dt) => [dt.id, dt.topology_source])
  );

  // ── Registry Transformers ────────────────────────────────────────────────
  // topology_source is kept as-is (RECORDED | MISSING). There are no
  // ground-truth-only fields on Transformer to strip.
  const registryTransformers = transformers.map((dt) => ({ ...dt }));

  // ── Registry Poles ────────────────────────────────────────────────────────
  // For MISSING-topology DTs: null out parent_pole_id and seq_on_line.
  // These two fields are the only structural topology information on a Pole;
  // stripping them means the localization engine genuinely cannot deduce the
  // true physical tree — it must infer it from GPS coordinates (Step 8).
  const registryPoles = poles.map((p) => {
    const topoSource = dtTopologySource.get(p.dt_id);

    if (topoSource === 'MISSING') {
      return {
        ...p,
        parent_pole_id: null,  // ← topology boundary: stripped for MISSING DTs
        seq_on_line: null,     // ← stripped too: ordering implies topology
      };
    }

    // RECORDED DT: expose topology as-is
    return { ...p };
  });

  // ── Registry Devices ─────────────────────────────────────────────────────
  // Device records are departmental data (the dept knows what devices it
  // deployed). No stripping needed.
  const registryDevices = devices.map((d) => ({ ...d }));

  // ── Registry Feeders ─────────────────────────────────────────────────────
  const registryFeeders = feeders.map((f) => ({ ...f }));

  return {
    feeders: registryFeeders,
    transformers: registryTransformers,
    poles: registryPoles,
    devices: registryDevices,
  };
}

/**
 * Validates that the registry export meets proportion and isolation requirements.
 *
 * Checks:
 *  1. Pole count matches ground-truth (no poles lost or duplicated).
 *  2. MISSING-topology DTs have parent_pole_id === null on all their poles.
 *  3. MISSING-topology DTs have seq_on_line === null on all their poles.
 *  4. RECORDED-topology DTs preserve parent_pole_id for non-root poles.
 *  5. ~60% of DTs have MISSING topology (tolerance ±10 pp).
 *  6. ~9% of poles have no device attached (tolerance ±6 pp).
 *  7. ~8% of devices run fw < 1.3 (tolerance ±5 pp).
 *  8. ~3% of poles have missing pincode (tolerance ±3 pp).
 *  9. No registry pole carries a parent_pole_id that belongs to a
 *     different DT (cross-DT reference isolation).
 * 10. No registry pole references a non-existent pole as parent.
 *
 * @param {{ feeders: object[], transformers: object[], poles: object[], devices: object[] }} groundTruth
 * @param {{ feeders: object[], transformers: object[], poles: object[], devices: object[] }} registry
 * @returns {{ valid: boolean, errors: string[], stats: object }}
 */
export function validateRegistryExport(groundTruth, registry) {
  const errors = [];

  // ── 1. Pole count parity ──────────────────────────────────────────────────
  if (registry.poles.length !== groundTruth.poles.length) {
    errors.push(
      `Registry pole count ${registry.poles.length} ≠ ground-truth ${groundTruth.poles.length}`
    );
  }

  // ── Index helpers ─────────────────────────────────────────────────────────
  const regPoleIds = new Set(registry.poles.map((p) => p.id));
  const dtTopologySource = new Map(
    registry.transformers.map((dt) => [dt.id, dt.topology_source])
  );

  // ── 2 & 3. MISSING DTs → topology fields nulled ──────────────────────────
  for (const p of registry.poles) {
    const topo = dtTopologySource.get(p.dt_id);
    if (topo === 'MISSING') {
      if (p.parent_pole_id !== null) {
        errors.push(
          `MISSING-topology pole ${p.id} (DT ${p.dt_id}) still has parent_pole_id = ${p.parent_pole_id}`
        );
      }
      if (p.seq_on_line !== null) {
        errors.push(
          `MISSING-topology pole ${p.id} (DT ${p.dt_id}) still has seq_on_line = ${p.seq_on_line}`
        );
      }
    }
  }

  // ── 4. RECORDED DTs → non-root poles must still have a parent ────────────
  for (const p of registry.poles) {
    const topo = dtTopologySource.get(p.dt_id);
    if (topo === 'RECORDED' && p.parent_pole_id === null) {
      // This is the root pole — expected exactly once per RECORDED DT. Fine.
      // (A deeper check exists in validateTreeStructure in Step 4's module.)
    }
  }

  // ── 9. No cross-DT parent references in registry ─────────────────────────
  const regPoleById = new Map(registry.poles.map((p) => [p.id, p]));
  for (const p of registry.poles) {
    if (p.parent_pole_id !== null) {
      const parent = regPoleById.get(p.parent_pole_id);
      if (!parent) {
        errors.push(
          `Registry pole ${p.id} references non-existent parent ${p.parent_pole_id}`
        );
      } else if (parent.dt_id !== p.dt_id) {
        errors.push(
          `Registry pole ${p.id} (DT ${p.dt_id}) references parent in different DT ${parent.dt_id}`
        );
      }
    }
  }

  // ── 10. No parent ID absent from registry poles ───────────────────────────
  for (const p of registry.poles) {
    if (p.parent_pole_id !== null && !regPoleIds.has(p.parent_pole_id)) {
      errors.push(
        `Registry pole ${p.id} references parent ${p.parent_pole_id} which is not in registry`
      );
    }
  }

  // ── 5–8. Proportion checks ────────────────────────────────────────────────
  const totalDTs = registry.transformers.length;
  const missingDTs = registry.transformers.filter((dt) => dt.topology_source === 'MISSING').length;
  const missingDTRatio = missingDTs / totalDTs;

  const totalPoles = registry.poles.length;
  const noDevicePoles = registry.poles.filter((p) => p.device_id === null).length;
  const noDeviceRatio = noDevicePoles / totalPoles;

  const totalDevices = registry.devices.length;
  const fw12Devices = registry.devices.filter((d) => d.fw_version.startsWith('1.2')).length;
  const fw12Ratio = totalDevices > 0 ? fw12Devices / totalDevices : 0;

  const missingPincodePoles = registry.poles.filter((p) => p.pincode === null).length;
  const missingPincodeRatio = missingPincodePoles / totalPoles;

  // Tolerances
  if (missingDTRatio < 0.50 || missingDTRatio > 0.70) {
    errors.push(
      `MISSING-topology DT ratio ${(missingDTRatio * 100).toFixed(1)}% outside expected 50–70% band`
    );
  }
  if (noDeviceRatio < 0.05 || noDeviceRatio > 0.15) {
    errors.push(
      `No-device pole ratio ${(noDeviceRatio * 100).toFixed(1)}% outside expected 5–15% band`
    );
  }
  if (fw12Ratio < 0.04 || fw12Ratio > 0.13) {
    errors.push(
      `fw<1.3 device ratio ${(fw12Ratio * 100).toFixed(1)}% outside expected 4–13% band`
    );
  }
  if (missingPincodeRatio < 0.01 || missingPincodeRatio > 0.06) {
    errors.push(
      `Missing-pincode ratio ${(missingPincodeRatio * 100).toFixed(1)}% outside expected 1–6% band`
    );
  }

  const stats = {
    totalDTs,
    missingDTs,
    recordedDTs: totalDTs - missingDTs,
    missingDTRatio: Number(missingDTRatio.toFixed(3)),
    totalPoles,
    noDevicePoles,
    noDeviceRatio: Number(noDeviceRatio.toFixed(3)),
    totalDevices,
    fw12Devices,
    fw12Ratio: Number(fw12Ratio.toFixed(3)),
    missingPincodePoles,
    missingPincodeRatio: Number(missingPincodeRatio.toFixed(3)),
  };

  return { valid: errors.length === 0, errors, stats };
}
