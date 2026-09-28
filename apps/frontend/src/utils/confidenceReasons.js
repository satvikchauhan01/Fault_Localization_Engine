/** Operator-facing wording for the confidence engine's reason codes. */
export const REASON_TEXT = {
  HIGH_CONFIDENCE: 'Recorded wiring, monitored boundary poles, explicit power-loss alarms.',
  INFERRED_TOPOLOGY: 'Wiring for this area is inferred from GPS, not on file.',
  INFERRED_AMBIGUOUS: 'Inferred wiring here is ambiguous: another route is almost as likely.',
  MISSING_DEVICE_GAP: 'The break is next to poles with no sensor.',
  RANGE_TOO_LARGE: 'The unmonitored stretch to search is long.',
  FW12_TIMEOUT_ONLY: 'Only legacy sensors went silent; no power-loss alarm was received.',
  HEARTBEAT_TIMEOUT_EVIDENCE: 'Some poles were declared dark from missed heartbeats, not alarms.',
  SENSOR_SUSPECT_PRESENT: 'A sensor contradicts its neighbours.',
  SCHEDULED_OUTAGE_OVERLAP: 'Overlaps a planned maintenance window.',
};

/** Reason codes of an incident, whether stored as strings or as { code } objects. */
export function reasonCodes(incident) {
  const raw = incident?.confidence_reasons;
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => (typeof r === 'string' ? r : r?.code)).filter(Boolean);
}
