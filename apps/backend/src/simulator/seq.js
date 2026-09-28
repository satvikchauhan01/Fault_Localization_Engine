// Deciseconds since 2025 fit Postgres int32 until late 2031. A millisecond clock
// taken modulo a bound wraps below stored seqs, and the engine then discards everything.
const SEQ_EPOCH_MS = Date.UTC(2025, 0, 1);
const SEQ_TICK_MS = 100;

let lastIssued = 0;

// One seq per burst: seq only orders messages from the same device.
export function nextSimulatorSeq(nowMs = Date.now()) {
  const clockSeq = Math.floor((nowMs - SEQ_EPOCH_MS) / SEQ_TICK_MS);
  lastIssued = Math.max(clockSeq, lastIssued + 1);
  return lastIssued;
}
