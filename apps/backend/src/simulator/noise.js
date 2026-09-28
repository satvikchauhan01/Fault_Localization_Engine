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

export { isLegacyFirmware as isFwLegacy } from '../../../../packages/domain/src/thresholds.js';

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

