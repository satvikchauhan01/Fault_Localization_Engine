/**
 * @file template-fallback.js
 * 
 * Provides a highly deterministic, templated summary of an incident.
 * Used when the AI service times out, lacks an API key, or encounters a network error.
 */

export function generateTemplateExplanation(incident) {
  const type = incident.type || 'UNKNOWN';
  const poleCount = incident.affected_pole_ids ? incident.affected_pole_ids.length : 0;
  const status = incident.ticket?.state || 'DETECTED';
  const date = incident.first_detected_at ? new Date(incident.first_detected_at).toLocaleDateString() : 'an unknown date';
  const time = incident.first_detected_at ? new Date(incident.first_detected_at).toLocaleTimeString() : 'an unknown time';

  return `A ${type} fault was detected on ${date} at ${time}. The telemetry engine has localized the issue to ${poleCount} affected pole(s). The current system state is ${status}. Field crews should be dispatched based on the localized coordinates.`;
}
