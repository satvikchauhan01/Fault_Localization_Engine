/**
 * @file pole-state.js
 * 
 * Pure functions implementing the PoleState derivation rules from Section H.
 * This module contains NO database or side-effect logic.
 */

import {
  DEBOUNCE_MS,
  HEARTBEAT_TIMEOUT_MS,
  FW_LEGACY_THRESHOLD,
} from '../../../../packages/domain/src/thresholds.js';


/**
 * Creates a default empty state for a new pole.
 */
function createEmptyState() {
  return {
    status: 'LIVE', // Default assumption until we hear otherwise
    last_confirmed_at: 0,
    last_event_seq: null,
    candidate_dark_since: null,
    evidence_summary: 'Initial state'
  };
}

/**
 * Evaluates a new telemetry event against the current pole state.
 * Implements Section H Rules 1, 2, 3, 5.
 * 
 * @param {Object|null} currentState The existing pole state (or null)
 * @param {Object} event The incoming TelemetryEvent
 * @returns {Object} The updated pole state
 */
export function processEvent(currentState, event) {
  // Rule 1: Discard events with seq <= last-processed seq (except boot)
  // Rule 5: A delayed power_lost arriving after a later-seq event is superseded.
  if (currentState && currentState.last_event_seq !== null && event.event !== 'boot') {
    if (event.seq <= currentState.last_event_seq) {
      return currentState; // Ignore out-of-order or duplicate event
    }
  }

  const state = currentState ? { ...currentState } : createEmptyState();
  
  state.last_event_seq = event.seq;

  // Rule 3: Accepted power_restored or heartbeat(energized=true) -> LIVE immediately
  if (event.event === 'power_restored' || (event.event === 'heartbeat' && event.energized === true)) {
    state.status = 'LIVE';
    state.candidate_dark_since = null;
    state.last_confirmed_at = event.server_received_at;
    state.evidence_summary = event.event === 'power_restored' ? 'power_restored' : 'heartbeat (energized)';
    return state;
  }

  // Rule 2: Accepted power_lost or heartbeat(energized=false) -> candidate DARK, pending debounce
  if (event.event === 'power_lost' || (event.event === 'heartbeat' && event.energized === false)) {
    if (state.candidate_dark_since === null && state.status !== 'CONFIRMED_DARK') {
      state.candidate_dark_since = event.server_received_at;
    }
    state.evidence_summary = event.event === 'power_lost' ? 'power_lost' : 'heartbeat (!energized)';
    // Note: status remains unchanged (e.g. LIVE) until debounce completes
    return state;
  }

  // Boot event just resets seq (handled above) and updates evidence
  if (event.event === 'boot') {
    state.evidence_summary = 'boot';
  }

  return state;
}

/**
 * Evaluates time-based state transitions (debounce and heartbeat timeouts).
 * Implements Section H Rules 4, 6.
 * 
 * @param {Object} currentState The existing pole state
 * @param {Object} device The associated Device (needs last_seen, fw_version)
 * @param {number} currentTime The current clock time (ms since epoch)
 * @returns {Object} The updated pole state
 */
export function evaluateTimeout(currentState, device, currentTime) {
  if (!currentState) return null;
  const state = { ...currentState };

  // Rule 6: Debounce. DARK is not confirmed until condition holds ~90s
  if (state.candidate_dark_since !== null && state.status !== 'CONFIRMED_DARK') {
    if (currentTime - state.candidate_dark_since >= DEBOUNCE_MS) {
      state.status = 'CONFIRMED_DARK';
      state.candidate_dark_since = null;
      state.last_confirmed_at = currentTime;
      state.evidence_summary = `${state.evidence_summary} (debounced)`;
      return state;
    }
  }

  // Rule 4: Background heartbeat-timeout scan
  if (device && device.last_seen) {
    if (currentTime - device.last_seen > HEARTBEAT_TIMEOUT_MS && state.status !== 'CONFIRMED_DARK') {
      state.status = 'CONFIRMED_DARK';
      state.candidate_dark_since = null;
      state.last_confirmed_at = currentTime;
      
      if (device.fw_version >= FW_LEGACY_THRESHOLD) {
        // absence of an expected power_lost plus silence is itself evidence
        state.evidence_summary = 'Missing heartbeat (fw >= 1.3)';
      } else {
        // only signal, by design
        state.evidence_summary = 'Missing heartbeat (fw < 1.3)';
      }
      return state;
    }
  }

  return state;
}
