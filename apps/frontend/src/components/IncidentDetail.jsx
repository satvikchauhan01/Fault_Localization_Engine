import React, { useMemo, useEffect, useState } from 'react';
import { useTicketWorkflow } from '../hooks/useTicketWorkflow';
import { X, CheckCircle, ShieldAlert, Loader2, Briefcase, Activity, Sparkles, MapPin, Calendar, Crosshair, Check } from 'lucide-react';
import { isLegacyFirmware, HEARTBEAT_TIMEOUT_MS } from '@kspdb/domain/thresholds';
import { locateFault, poleCondition } from '../utils/networkModel';
import { REASON_TEXT, reasonCodes } from '../utils/confidenceReasons';

const WORKFLOW = [
  { state: 'DETECTED', label: 'Detected' },
  { state: 'ACKNOWLEDGED', label: 'Acknowledged' },
  { state: 'CREW_ASSIGNED', label: 'Crew assigned' },
  { state: 'RESOLVED', label: 'Resolved' },
  { state: 'VERIFIED', label: 'Verified' },
];

const NEXT_ACTION = {
  DETECTED: { state: 'ACKNOWLEDGED', label: 'Acknowledge fault', icon: CheckCircle },
  ACKNOWLEDGED: { state: 'CREW_ASSIGNED', label: 'Dispatch field crew', icon: Briefcase },
  CREW_ASSIGNED: { state: 'RESOLVED', label: 'Mark repaired', icon: Activity },
};

const CONFIDENCE_STYLE = {
  HIGH: 'text-emerald-300 bg-emerald-950/50 border-emerald-900',
  MEDIUM: 'text-amber-300 bg-amber-950/50 border-amber-900',
  LOW: 'text-red-300 bg-red-950/50 border-red-900',
};

function Section({ title, icon: Icon, children }) {
  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {title}
      </h3>
      {children}
    </section>
  );
}

export default function IncidentDetail({ incident, index, onClose, onLocate, onSelect }) {
  const { transitionTicket, isTransitioning, transitionError, clearError } = useTicketWorkflow();
  const [explanation, setExplanation] = useState(null);
  const [isExplaining, setIsExplaining] = useState(true);
  const incidentId = incident?.id;

  useEffect(() => {
    if (!incidentId) return;
    setIsExplaining(true);
    setExplanation(null);
    fetch(`/api/incidents/${incidentId}/explain`)
      .then((res) => res.json())
      .then((data) => setExplanation(data.explanation))
      .catch(() => setExplanation('The summary could not be loaded.'))
      .finally(() => setIsExplaining(false));
  }, [incidentId]);

  const location = useMemo(() => (incident ? locateFault(incident, index) : null), [incident, index]);

  const scope = useMemo(() => {
    if (!incident) return null;
    const affected = (incident.affected_pole_ids || []).map((id) => index.poleById.get(id)).filter(Boolean);
    const monitored = affected.filter((p) => p.device_id);
    const dark = monitored.filter((p) => poleCondition(p) === 'dark');
    // Same rule as the backend rollup: a legacy sensor sends no power-loss alarm,
    // so until its heartbeat times out a "live" reading from it proves nothing.
    const silentLegacy = monitored.filter(
      (p) => poleCondition(p) !== 'dark' && isLegacyFirmware(index.deviceByPole.get(p.id)?.fw_version),
    );
    return {
      affected,
      reporting: monitored.length - silentLegacy.length,
      silentLegacy: silentLegacy.length,
      dark: dark.length,
      dtIds: [...new Set(affected.map((p) => p.dt_id))],
      feederId: affected[0]?.feeder_id,
      wards: [...new Set(affected.map((p) => p.ward).filter(Boolean))],
      pincodes: [...new Set(affected.map((p) => p.pincode).filter(Boolean))],
    };
  }, [incident, index]);

  if (!incident) return null;

  const ticket = incident.ticket;
  const stepIndex = WORKFLOW.findIndex((s) => s.state === ticket?.state);
  const next = NEXT_ACTION[ticket?.state];
  const restoredPct = scope.reporting > 0 ? ((scope.reporting - scope.dark) / scope.reporting) * 100 : 0;
  const reasons = reasonCodes(incident);

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 py-3 border-b border-slate-800">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider rounded border border-red-900 bg-red-950/60 text-red-300">
                {incident.type} fault
              </span>
              <span className={`px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider rounded border ${CONFIDENCE_STYLE[incident.confidence]}`}>
                {incident.confidence} confidence
              </span>
            </div>
            <h2 className="font-semibold text-slate-100 mt-1.5 leading-snug">{location?.title || 'Fault'}</h2>
            <p className="text-[11px] text-slate-500 font-mono mt-0.5">
              Ticket #{ticket?.id.slice(0, 8)}, detected {new Date(incident.first_detected_at).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-slate-500 hover:text-slate-200 hover:bg-slate-800" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-5">
        {location && (
          <Section title="Where to send the crew" icon={MapPin}>
            <div className="rounded-md border border-red-900/70 bg-red-950/30 p-3">
              <p className="text-sm text-slate-200 leading-relaxed">{location.detail}</p>
              {scope.reporting > 0 && scope.dark === 0 && (
                <p className="mt-2 text-sm text-emerald-300">Supply is back on every reporting pole in this section.</p>
              )}
              <button
                onClick={onLocate}
                className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700"
              >
                <Crosshair className="w-4 h-4" /> Locate on map
              </button>
            </div>
          </Section>
        )}

        <Section title="Workflow">
          <ol className="flex items-center gap-1">
            {WORKFLOW.map((step, i) => {
              const done = i < stepIndex || ticket?.state === 'VERIFIED';
              const current = i === stepIndex && ticket?.state !== 'VERIFIED';
              return (
                <li key={step.state} className="flex-1 min-w-0">
                  <div className={`h-1.5 rounded-sm ${done ? 'bg-emerald-500' : current ? 'bg-blue-500' : 'bg-slate-800'}`} />
                  <div className={`mt-1.5 text-[10px] leading-tight truncate ${current ? 'text-slate-100 font-medium' : done ? 'text-slate-400' : 'text-slate-600'}`}>
                    {done && <Check className="inline w-3 h-3 -mt-0.5 mr-0.5" />}
                    {step.label}
                  </div>
                </li>
              );
            })}
          </ol>

          {transitionError && (
            <div className="mt-3 p-3 bg-red-950/50 border border-red-900 rounded-md flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-300 flex-1">{transitionError}</p>
              <button onClick={clearError} className="text-red-400 hover:text-red-200" aria-label="Dismiss">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {next && (
            <button
              onClick={() => transitionTicket(ticket.id, next.state)}
              disabled={isTransitioning}
              className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isTransitioning ? <Loader2 className="w-4 h-4 animate-spin" /> : <next.icon className="w-4 h-4" />}
              {next.label}
            </button>
          )}

          {ticket?.state === 'RESOLVED' && (
            <div className="mt-3 p-3 bg-slate-900 border border-slate-800 rounded-md flex items-start gap-2 text-xs text-slate-400">
              <Loader2 className="w-4 h-4 text-blue-400 animate-spin flex-shrink-0" />
              Waiting for telemetry to confirm every monitored pole is live. The ticket moves to Verified on its own.
            </div>
          )}
        </Section>

        <Section title="Restoration">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-slate-300">{scope.reporting - scope.dark} of {scope.reporting} reporting poles live</span>
            <span className="text-xs text-slate-500">{scope.affected.length} poles in scope</span>
          </div>
          <div className="mt-2 w-full h-2 bg-red-900/70 rounded-sm overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all duration-700" style={{ width: `${restoredPct}%` }} />
          </div>
          {scope.silentLegacy > 0 && scope.dark > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              Not counted: {scope.silentLegacy} legacy {scope.silentLegacy === 1 ? 'sensor' : 'sensors'} with no power-loss alarm.
              {' '}{scope.silentLegacy === 1 ? 'It shows' : 'They show'} dark only after {HEARTBEAT_TIMEOUT_MS / 60_000} minutes of silence.
            </p>
          )}
        </Section>

        <Section title="Why this confidence">
          <ul className="space-y-1.5">
            {reasons.map((code) => (
              <li key={code} className="text-sm text-slate-300 flex gap-2">
                <span className="text-slate-600 mt-1.5 w-1 h-1 rounded-full bg-slate-500 flex-shrink-0" />
                {REASON_TEXT[code] || code}
              </li>
            ))}
          </ul>
        </Section>

        {incident.scheduled_outage_overlap && (
          <div className="flex items-start gap-2 bg-violet-950/40 border border-violet-900/60 rounded-md px-3 py-2.5 text-xs text-violet-200">
            <Calendar className="w-4 h-4 text-violet-300 flex-shrink-0" />
            This fault overlaps a planned maintenance window, so confidence is capped. It may be the planned work itself.
          </div>
        )}

        <Section title="Affected area">
          <dl className="text-sm">
            <div className="flex justify-between py-1.5 border-b border-slate-800/70">
              <dt className="text-slate-500">Feeder</dt>
              <dd>
                <button onClick={() => onSelect({ kind: 'feeder', id: scope.feederId })} className="font-mono text-blue-400 hover:underline">{scope.feederId}</button>
              </dd>
            </div>
            <div className="flex justify-between gap-4 py-1.5 border-b border-slate-800/70">
              <dt className="text-slate-500">{scope.dtIds.length > 1 ? 'Transformers' : 'Transformer'}</dt>
              <dd className="text-right">
                {scope.dtIds.slice(0, 8).map((id, i) => (
                  <React.Fragment key={id}>
                    {i > 0 && ', '}
                    <button onClick={() => onSelect({ kind: 'dt', id })} className="font-mono text-blue-400 hover:underline">{id}</button>
                  </React.Fragment>
                ))}
                {scope.dtIds.length > 8 && <span className="text-slate-500">, +{scope.dtIds.length - 8} more</span>}
              </dd>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-800/70">
              <dt className="text-slate-500">Ward</dt>
              <dd className="text-slate-200 text-right">{scope.wards.join(', ') || 'N/A'}</dd>
            </div>
            <div className="flex justify-between py-1.5">
              <dt className="text-slate-500">PIN code</dt>
              <dd className="text-slate-200 text-right">{scope.pincodes.join(', ') || 'N/A'}</dd>
            </div>
          </dl>
        </Section>

        <Section title="Summary" icon={Sparkles}>
          {isExplaining ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-2.5 bg-slate-800 rounded-sm w-full" />
              <div className="h-2.5 bg-slate-800 rounded-sm w-5/6" />
              <div className="h-2.5 bg-slate-800 rounded-sm w-4/6" />
            </div>
          ) : (
            <p className="text-sm text-slate-400 leading-relaxed">{explanation}</p>
          )}
        </Section>
      </div>
    </div>
  );
}
