import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { History, ChevronDown, ChevronUp, Search, RefreshCw, AlertTriangle, Calendar, Crosshair } from 'lucide-react';
import { locateFault } from '../utils/networkModel';
import { REASON_TEXT, reasonCodes } from '../utils/confidenceReasons';

function formatDate(iso) {
  if (!iso) return 'N/A';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function durationMs(incident) {
  const end = incident.ticket?.verified_at || incident.ticket?.resolved_at;
  if (!incident.first_detected_at || !end) return null;
  const ms = new Date(end) - new Date(incident.first_detected_at);
  return ms >= 0 ? ms : null;
}

function formatDuration(ms) {
  if (ms == null) return 'N/A';
  const mins = Math.round(ms / 60000);
  const hrs = Math.floor(mins / 60);
  return hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;
}

const CONF_DOT = { HIGH: 'bg-emerald-400', MEDIUM: 'bg-amber-400', LOW: 'bg-red-400' };

const STATE_STYLE = {
  VERIFIED: 'text-emerald-300 bg-emerald-950/50 border-emerald-900',
  CLOSED: 'text-slate-400 bg-slate-800 border-slate-700',
  RESOLVED: 'text-blue-300 bg-blue-950/50 border-blue-900',
};

const SELECT_CLASS = 'bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-blue-500';

function Row({ label, children }) {
  return (
    <div className="flex justify-between gap-4 text-sm py-1">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200 text-right">{children}</span>
    </div>
  );
}

function HistoryRow({ incident, index, onShowOnMap }) {
  const [expanded, setExpanded] = useState(false);
  const ticket = incident.ticket;
  const location = useMemo(() => locateFault(incident, index), [incident, index]);
  const affectedIds = Array.isArray(incident.affected_pole_ids) ? incident.affected_pole_ids : [];
  const firstPole = index.poleById.get(affectedIds[0]);
  const reasons = reasonCodes(incident);

  return (
    <div className="border border-slate-800 rounded-md overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-3 sm:gap-4 px-4 py-3 bg-slate-900 hover:bg-slate-800/70 text-left"
      >
        <span className="flex-shrink-0 w-14 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{incident.type}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-100 truncate">{location?.title || incident.type}</div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5">#{incident.id.slice(0, 8)}</div>
        </div>
        <span className="hidden sm:flex items-center gap-1.5 flex-shrink-0 text-xs text-slate-400">
          <span className={`w-1.5 h-1.5 rounded-full ${CONF_DOT[incident.confidence]}`} />
          {incident.confidence}
        </span>
        <span className="hidden md:block w-20 text-right flex-shrink-0 text-xs text-slate-400">{incident.affected_count} poles</span>
        <span className="hidden md:block w-16 text-right flex-shrink-0 text-xs text-slate-400">{formatDuration(durationMs(incident))}</span>
        <span className={`flex-shrink-0 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded border ${STATE_STYLE[ticket?.state] || STATE_STYLE.CLOSED}`}>
          {ticket?.state || 'CLOSED'}
        </span>
        <span className="hidden xl:block w-44 text-right flex-shrink-0 text-xs text-slate-500">{formatDate(incident.first_detected_at)}</span>
        {expanded ? <ChevronUp className="w-4 h-4 text-slate-500 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t border-slate-800 bg-slate-950 px-4 py-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Timeline</h4>
            <Row label="Detected">{formatDate(incident.first_detected_at)}</Row>
            {ticket?.resolved_at && <Row label="Marked repaired">{formatDate(ticket.resolved_at)}</Row>}
            {ticket?.verified_at && <Row label="Verified by telemetry">{formatDate(ticket.verified_at)}</Row>}
            <div className="border-t border-slate-800 mt-1 pt-1">
              <Row label="Outage duration"><span className="font-semibold">{formatDuration(durationMs(incident))}</span></Row>
            </div>
          </section>

          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Fault</h4>
            {firstPole && <Row label="Feeder / transformer"><span className="font-mono">{firstPole.feeder_id} / {firstPole.dt_id}</span></Row>}
            <Row label="Wiring">{incident.topology_source === 'INFERRED' ? 'Inferred from GPS' : 'Recorded'}</Row>
            <Row label="Confidence">{incident.confidence}</Row>
            {incident.scheduled_outage_overlap && (
              <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-950/40 border border-amber-900 rounded-md px-2 py-1.5 mt-2">
                <Calendar className="w-3.5 h-3.5" /> Overlapped a scheduled outage
              </div>
            )}
            {reasons.length > 0 && (
              <ul className="mt-3 space-y-1">
                {reasons.map((code) => (
                  <li key={code} className="text-xs text-slate-400">{REASON_TEXT[code] || code}</li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
              Affected poles ({affectedIds.length})
            </h4>
            {affectedIds.length === 0 ? (
              <p className="text-xs text-slate-600">No pole IDs recorded.</p>
            ) : (
              <div className="flex flex-wrap gap-1 max-h-36 overflow-y-auto custom-scrollbar pr-1">
                {affectedIds.map((id) => (
                  <button
                    key={id}
                    onClick={() => onShowOnMap({ kind: 'pole', id })}
                    title="Show on map"
                    className="px-1.5 py-0.5 bg-slate-900 border border-slate-800 rounded text-[11px] font-mono text-slate-400 hover:text-slate-100 hover:border-slate-600"
                  >
                    {id}
                  </button>
                ))}
              </div>
            )}
            {firstPole && (
              <button
                onClick={() => onShowOnMap({ kind: 'dt', id: firstPole.dt_id })}
                className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700"
              >
                <Crosshair className="w-4 h-4" /> Show area on map
              </button>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Summary({ incidents }) {
  const count = (key) => incidents.reduce((acc, i) => ({ ...acc, [i[key]]: (acc[i[key]] || 0) + 1 }), {});
  const byType = count('type');
  const byConf = count('confidence');
  const durations = incidents.map(durationMs).filter((d) => d != null);
  const avgDuration = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  const avgPoles = incidents.length ? Math.round(incidents.reduce((s, i) => s + i.affected_count, 0) / incidents.length) : 0;

  const cells = [
    { label: 'Incidents', value: incidents.length },
    { label: 'Span / DT / Feeder / Range', value: `${byType.SPAN || 0} / ${byType.DT || 0} / ${byType.FEEDER || 0} / ${byType.RANGE || 0}` },
    { label: 'High / Medium / Low', value: `${byConf.HIGH || 0} / ${byConf.MEDIUM || 0} / ${byConf.LOW || 0}` },
    { label: 'Avg poles affected', value: avgPoles },
    { label: 'Avg outage duration', value: formatDuration(avgDuration) },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-px bg-slate-800 border border-slate-800 rounded-md overflow-hidden mb-4">
      {cells.map((c) => (
        <div key={c.label} className="bg-slate-900 px-4 py-3">
          <div className="text-lg font-semibold text-slate-100 tabular-nums">{c.value}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Closed-out incidents (resolved, verified or closed), shown inside the main layout. */
export default function IncidentHistoryPanel({ index, onShowOnMap }) {
  const [data, setData] = useState({ incidents: [], total: 0 });
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [confFilter, setConfFilter] = useState('ALL');
  const [stateFilter, setStateFilter] = useState('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 200 });
      if (typeFilter !== 'ALL') params.set('type', typeFilter);
      if (confFilter !== 'ALL') params.set('confidence', confFilter);
      const res = await fetch(`/api/incidents/history?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, confFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = data.incidents.filter((i) => {
    if (stateFilter !== 'ALL' && i.ticket?.state !== stateFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      i.id.toLowerCase().includes(q) ||
      i.type.toLowerCase().includes(q) ||
      (i.affected_pole_ids || []).some((id) => id.toLowerCase() === q) ||
      (locateFault(i, index)?.title || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-shrink-0 px-3 sm:px-5 py-3 border-b border-slate-800 bg-slate-900 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search pole, fault or ticket ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-700 rounded-md text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={SELECT_CLASS} aria-label="Fault type">
          {['ALL', 'SPAN', 'DT', 'FEEDER', 'RANGE'].map((o) => <option key={o} value={o}>{o === 'ALL' ? 'All types' : o}</option>)}
        </select>
        <select value={confFilter} onChange={(e) => setConfFilter(e.target.value)} className={SELECT_CLASS} aria-label="Confidence">
          {['ALL', 'HIGH', 'MEDIUM', 'LOW'].map((o) => <option key={o} value={o}>{o === 'ALL' ? 'Any confidence' : o}</option>)}
        </select>
        <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className={SELECT_CLASS} aria-label="Ticket state">
          {['ALL', 'VERIFIED', 'RESOLVED', 'CLOSED'].map((o) => <option key={o} value={o}>{o === 'ALL' ? 'Any state' : o}</option>)}
        </select>
        <span className="text-xs text-slate-500 ml-auto">{filtered.length} of {data.total}</span>
        <button
          onClick={load}
          disabled={isLoading}
          className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-md"
          aria-label="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-3 sm:px-5 py-4">
        {isLoading && data.incidents.length === 0 ? (
          <div className="h-full flex items-center justify-center gap-3 text-slate-500 text-sm">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading history
          </div>
        ) : error ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <AlertTriangle className="w-6 h-6 text-red-400 mb-2" />
            <p className="text-red-300 text-sm">History could not be loaded ({error}).</p>
            <button onClick={load} className="mt-3 text-sm text-slate-400 hover:text-slate-100">Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
            <History className="w-8 h-8 text-slate-700" />
            <p className="text-sm">{data.total === 0 ? 'No closed incidents yet.' : 'Nothing matches these filters.'}</p>
            {data.total === 0 && <p className="text-xs text-slate-600">Faults appear here once they are repaired and verified.</p>}
          </div>
        ) : (
          <>
            <Summary incidents={filtered} />
            <div className="space-y-1.5">
              {filtered.map((i) => <HistoryRow key={i.id} incident={i} index={index} onShowOnMap={onShowOnMap} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
