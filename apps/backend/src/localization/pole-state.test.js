import { describe, it, expect } from 'vitest';
import { processEvent, evaluateTimeout } from './pole-state.js';

describe('processEvent', () => {
  it('creates default LIVE state on first event', () => {
    const event = { event: 'heartbeat', energized: true, seq: 1, server_received_at: 1000 };
    const newState = processEvent(null, event);
    expect(newState.status).toBe('LIVE');
    expect(newState.last_event_seq).toBe(1);
    expect(newState.candidate_dark_since).toBeNull();
  });

  it('Rule 1: discards events with older or equal seq', () => {
    const state = { status: 'LIVE', last_event_seq: 10, candidate_dark_since: null };
    
    // Older seq
    const event1 = { event: 'power_lost', seq: 9, server_received_at: 2000 };
    let newState = processEvent(state, event1);
    expect(newState).toBe(state); // Strict equality means it was discarded

    // Equal seq
    const event2 = { event: 'power_lost', seq: 10, server_received_at: 2000 };
    newState = processEvent(state, event2);
    expect(newState).toBe(state);
  });

  it('Rule 1: allows boot events to reset seq', () => {
    const state = { status: 'LIVE', last_event_seq: 10, candidate_dark_since: null, evidence_summary: 'old' };
    const event = { event: 'boot', seq: 1, server_received_at: 2000 };
    
    const newState = processEvent(state, event);
    expect(newState).not.toBe(state);
    expect(newState.last_event_seq).toBe(1); // seq is reset
    expect(newState.status).toBe('LIVE'); // status untouched
    expect(newState.evidence_summary).toBe('boot');
  });

  it('Rule 2: power_lost sets candidate_dark_since but does not change status immediately', () => {
    const state = { status: 'LIVE', last_event_seq: 10, candidate_dark_since: null };
    const event = { event: 'power_lost', seq: 11, server_received_at: 5000 };
    
    const newState = processEvent(state, event);
    expect(newState.status).toBe('LIVE'); // Not dark yet
    expect(newState.candidate_dark_since).toBe(5000);
    expect(newState.evidence_summary).toBe('power_lost');
  });

  it('Rule 2: heartbeat(!energized) sets candidate_dark_since', () => {
    const state = { status: 'LIVE', last_event_seq: 10, candidate_dark_since: null };
    const event = { event: 'heartbeat', energized: false, seq: 11, server_received_at: 6000 };
    
    const newState = processEvent(state, event);
    expect(newState.status).toBe('LIVE');
    expect(newState.candidate_dark_since).toBe(6000);
    expect(newState.evidence_summary).toBe('heartbeat (!energized)');
  });

  it('Rule 3: power_restored clears candidate_dark and sets LIVE', () => {
    const state = { status: 'LIVE', last_event_seq: 10, candidate_dark_since: 5000 }; // Pending debounce
    const event = { event: 'power_restored', seq: 11, server_received_at: 10000 };
    
    const newState = processEvent(state, event);
    expect(newState.status).toBe('LIVE');
    expect(newState.candidate_dark_since).toBeNull();
    expect(newState.last_confirmed_at).toBe(10000);
    expect(newState.evidence_summary).toBe('power_restored');
  });

  it('Rule 3: heartbeat(energized) recovers from CONFIRMED_DARK', () => {
    const state = { status: 'CONFIRMED_DARK', last_event_seq: 10, candidate_dark_since: null };
    const event = { event: 'heartbeat', energized: true, seq: 11, server_received_at: 20000 };
    
    const newState = processEvent(state, event);
    expect(newState.status).toBe('LIVE');
    expect(newState.candidate_dark_since).toBeNull();
    expect(newState.evidence_summary).toBe('heartbeat (energized)');
  });

  it('Rule 5: Supersedes late events naturally via Rule 1', () => {
    // We get power_restored at seq 10
    const state1 = processEvent(null, { event: 'power_restored', seq: 10, server_received_at: 1000 });
    // We then receive a delayed power_lost that happened at seq 9
    const state2 = processEvent(state1, { event: 'power_lost', seq: 9, server_received_at: 1500 });
    
    expect(state2).toBe(state1); // Discarded!
  });
});

describe('evaluateTimeout', () => {
  it('returns null if state is null', () => {
    expect(evaluateTimeout(null, {}, 1000)).toBeNull();
  });

  it('Rule 6: Debounces candidate_dark into CONFIRMED_DARK after 90s', () => {
    const state = { status: 'LIVE', candidate_dark_since: 1000, evidence_summary: 'power_lost' };
    const device = { last_seen: 1000, fw_version: '1.3' };
    
    // At 80s, no change
    let newState = evaluateTimeout(state, device, 1000 + 80000);
    expect(newState.status).toBe('LIVE');

    // At 90s, transitions!
    newState = evaluateTimeout(state, device, 1000 + 90000);
    expect(newState.status).toBe('CONFIRMED_DARK');
    expect(newState.candidate_dark_since).toBeNull();
    expect(newState.last_confirmed_at).toBe(1000 + 90000);
    expect(newState.evidence_summary).toBe('power_lost (debounced)');
  });

  it('Rule 4: Transitions to CONFIRMED_DARK after 32m of silence (fw >= 1.3)', () => {
    const state = { status: 'LIVE', candidate_dark_since: null, evidence_summary: 'ok' };
    const device = { last_seen: 1000, fw_version: '1.3.1' }; // > 1.3
    
    const TIMEOUT_MS = 32 * 60 * 1000;
    
    // At 30m, no change
    let newState = evaluateTimeout(state, device, 1000 + (30 * 60 * 1000));
    expect(newState.status).toBe('LIVE');

    // At > 32m, transitions
    newState = evaluateTimeout(state, device, 1000 + TIMEOUT_MS + 1000);
    expect(newState.status).toBe('CONFIRMED_DARK');
    expect(newState.evidence_summary).toBe('Missing heartbeat (fw >= 1.3)');
  });

  it('Rule 4: Transitions to CONFIRMED_DARK after 32m of silence (fw < 1.3)', () => {
    const state = { status: 'LIVE', candidate_dark_since: null, evidence_summary: 'ok' };
    const device = { last_seen: 1000, fw_version: '1.2.5' }; // < 1.3
    
    const TIMEOUT_MS = 32 * 60 * 1000;
    
    // At > 32m, transitions
    const newState = evaluateTimeout(state, device, 1000 + TIMEOUT_MS + 1000);
    expect(newState.status).toBe('CONFIRMED_DARK');
    expect(newState.evidence_summary).toBe('Missing heartbeat (fw < 1.3)');
  });

  it('Does not double-trigger timeout if already CONFIRMED_DARK', () => {
    const state = { status: 'CONFIRMED_DARK', candidate_dark_since: null, evidence_summary: 'manual' };
    const device = { last_seen: 1000, fw_version: '1.3.1' };
    
    const TIMEOUT_MS = 32 * 60 * 1000;
    
    const newState = evaluateTimeout(state, device, 1000 + TIMEOUT_MS + 1000);
    // If it didn't trigger, object identity is preserved or evidence is untouched
    expect(newState.evidence_summary).toBe('manual');
  });
});
