/**
 * @file noise.js — Simulator Noise Injection Utilities
 *
 * Provides helper functions for applying duplicate resends and out-of-order/delayed
 * delivery to simulated telemetry payload streams.
 */

/**
 * Applies noise transformations (duplicates and reordering) to an array of telemetry payloads.
 *
 * @param {object[]} payloads Array of telemetry payloads
 * @param {object} [options]
 * @param {boolean} [options.duplicates] If true, duplicates each payload in the stream
 * @param {boolean} [options.duplicateResends] Alias for duplicates
 * @param {boolean} [options.reorder] If true, reverses/reorders the transmission order
 * @param {boolean} [options.delayedDelivery] Alias for reorder
 * @returns {object[]} Noise-transformed array of payloads
 */
export function applyNoiseToPayloads(payloads, options = {}) {
  const {
    duplicates = false,
    duplicateResends = false,
    reorder = false,
    delayedDelivery = false,
  } = options;

  const isDuplicates = Boolean(duplicates || duplicateResends);
  const isReorder = Boolean(reorder || delayedDelivery);

  let result = [...payloads];

  if (isDuplicates) {
    const duplicated = [];
    for (const p of result) {
      duplicated.push(p);
      // Append duplicate copy of identical payload (same device_id, seq, device_ts)
      duplicated.push({ ...p });
    }
    result = duplicated;
  }

  if (isReorder && result.length > 1) {
    // Reverse/reorder payloads to simulate out-of-order arrival
    result = [...result].reverse();
  }

  return result;
}

/**
 * Checks if firmware version is legacy (< 1.3.0) using semantic version comparison.
 *
 * @param {string} fwStr Firmware version string (e.g. '1.2.1', '1.10.0')
 * @returns {boolean} True if fw < 1.3
 */
export function isFwLegacy(fwStr) {
  if (!fwStr || typeof fwStr !== 'string') return false;
  const parts = fwStr.split('.').map(p => parseInt(p, 10) || 0);
  const major = parts[0] || 0;
  const minor = parts[1] || 0;
  if (major < 1) return true;
  if (major === 1 && minor < 3) return true;
  return false;
}

/**
 * Deterministically computes whether a device's dying power_lost message is lost
 * (~30% failure rate based on device ID hash).
 *
 * @param {string} deviceId Device ID
 * @returns {boolean} True if dying message is lost
 */
export function isDyingMessageLost(deviceId) {
  if (!deviceId) return false;
  let hash = 0;
  for (let i = 0; i < deviceId.length; i++) {
    hash = (hash * 31 + deviceId.charCodeAt(i)) & 0x7fffffff;
  }
  return (hash % 100) < 30; // 30% failure rate deterministically
}

