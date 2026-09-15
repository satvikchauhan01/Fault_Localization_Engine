import React, { useState, useEffect, useCallback } from 'react';
import {
  History, ChevronDown, ChevronUp, Search, Filter,
  CheckCircle2, Clock, Zap, AlertTriangle,
  MapPin, Layers, BarChart2, RefreshCw, Calendar
} from 'lucide-react';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function duration(start, end) {
  if (!start || !end) return '—';
  const ms = new Date(end) - new Date(start);
  if (ms < 0) return '—';
  const mins = Math.floor(ms / 60000);
  const hrs  = Math.floor(mins / 60);
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  return `${mins}m`;
}

const TYPE_META = {
  SPAN:   { color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/30',   label: 'SPAN FAULT'   },
  DT:     { color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/30', label: 'DT FAULT'  },
  FEEDER: { color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/30', label: 'FEEDER FAULT' },
  RANGE:  { color: 'text-cyan-400',   bg: 'bg-cyan-500/10 border-cyan-500/30',   label: 'RANGE FAULT'  },
};

const CONF_META = {
  HIGH:   { color: 'text-green-400',  dot: 'bg-green-400'  },
  MEDIUM: { color: 'text-yellow-400', dot: 'bg-yellow-400' },
  LOW:    { color: 'text-red-400',    dot: 'bg-red-400'    },
};

const STATE_META = {
  VERIFIED: { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', label: 'Verified' },
  CLOSED:   { color: 'text-slate-400',   bg: 'bg-slate-500/10 border-slate-500/30',     label: 'Closed'   },
  RESOLVED: { color: 'text-blue-400',    bg: 'bg-blue-500/10 border-blue-500/30',       label: 'Resolved' },
};

// ─── Row Component ────────────────────────────────────────────────────────────

function HistoryRow({ incident }) {
  const [expanded, setExpanded] = useState(false);
  const ticket   = incident.ticket;
  const typeMeta = TYPE_META[incident.type] || TYPE_META.SPAN;
  const confMeta = CONF_META[incident.confidence] || CONF_META.MEDIUM;
  const stateMeta = ticket ? (STATE_META[ticket.state] || STATE_META.CLOSED) : STATE_META.CLOSED;

  const affectedIds = Array.isArray(incident.affected_pole_ids)
    ? incident.affected_pole_ids
    : (incident.affected_pole_ids ? JSON.parse(incident.affected_pole_ids) : []);

  const outageEnd   = ticket?.verified_at || ticket?.resolved_at || ticket?.updated_at;
  const outageDur   = duration(incident.first_detected_at, outageEnd);

  return (
    <div className="rounded-xl border border-slate-800 overflow-hidden transition-colors hover:border-slate-700">
      {/* Header Row */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-4 px-5 py-4 bg-slate-900/60 hover:bg-slate-900 transition-colors text-left"
      >
        {/* Type badge */}
        <span className={`flex-shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${typeMeta.bg} ${typeMeta.color}`}>
          {typeMeta.label}
        </span>

        {/* Target */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-200 truncate">
            {incident.upstream_live_pole_id
              ? `Upstream: ${incident.upstream_live_pole_id}`
              : incident.type === 'FEEDER' ? 'Feeder-level Fault'
              : incident.type === 'DT'     ? 'DT-level Fault'
              : 'Range Fault'}
          </div>
          <div className="text-xs text-slate-500 font-mono mt-0.5">{incident.id.substring(0, 12)}…</div>
        </div>

        {/* Confidence */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${confMeta.dot}`}></span>
          <span className={`text-xs font-medium ${confMeta.color}`}>{incident.confidence}</span>
        </div>

        {/* Poles affected */}
        <div className="flex items-center gap-1.5 text-slate-400 flex-shrink-0">
          <Zap className="w-3.5 h-3.5" />
          <span className="text-xs">{incident.affected_count} poles</span>
        </div>

        {/* Duration */}
        <div className="flex items-center gap-1.5 text-slate-400 flex-shrink-0">
          <Clock className="w-3.5 h-3.5" />
          <span className="text-xs">{outageDur}</span>
        </div>

        {/* State badge */}
        <span className={`flex-shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${stateMeta.bg} ${stateMeta.color}`}>
          {stateMeta.label}
        </span>

        {/* Date */}
        <div className="text-xs text-slate-500 flex-shrink-0 hidden xl:block">
          {formatDate(incident.first_detected_at)}
        </div>

        {/* Expand chevron */}
        <div className="flex-shrink-0 text-slate-500">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/* Expanded Detail */}
      {expanded && (
        <div className="border-t border-slate-800 bg-slate-950/60 px-5 py-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">

          {/* Timeline */}
          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" /> Timeline
            </h4>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Detected</span>
                <span className="text-slate-200 font-mono text-xs">{formatDate(incident.first_detected_at)}</span>
              </div>
              {ticket?.created_at && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Ticket Created</span>
                  <span className="text-slate-200 font-mono text-xs">{formatDate(ticket.created_at)}</span>
                </div>
              )}
              {ticket?.resolved_at && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Resolved</span>
                  <span className="text-emerald-400 font-mono text-xs">{formatDate(ticket.resolved_at)}</span>
                </div>
              )}
              {ticket?.verified_at && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Verified</span>
                  <span className="text-emerald-400 font-mono text-xs">{formatDate(ticket.verified_at)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm pt-1 border-t border-slate-800">
                <span className="text-slate-400">Total Outage Duration</span>
                <span className="text-white font-semibold">{outageDur}</span>
              </div>
            </div>
          </div>

          {/* Fault Details */}
          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Fault Details
            </h4>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Type</span>
                <span className={`font-semibold ${typeMeta.color}`}>{incident.type}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Confidence</span>
                <span className={`font-semibold ${confMeta.color}`}>{incident.confidence}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Topology Source</span>
                <span className="text-slate-200">{incident.topology_source}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Poles Affected</span>
                <span className="text-slate-200 font-semibold">{incident.affected_count}</span>
              </div>
              {incident.upstream_live_pole_id && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Upstream Pole</span>
                  <span className="text-blue-400 font-mono text-xs">{incident.upstream_live_pole_id}</span>
                </div>
              )}
              {incident.scheduled_outage_overlap && (
                <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1 mt-1">
                  <Calendar className="w-3 h-3" />
                  Overlapped with scheduled outage
                </div>
              )}
            </div>
          </div>

          {/* Affected Poles */}
          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" /> Affected Poles ({affectedIds.length})
            </h4>
            <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto custom-scrollbar pr-1">
              {affectedIds.slice(0, 40).map(id => (
                <span key={id} className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-[10px] font-mono text-slate-400">
                  {id}
                </span>
              ))}
              {affectedIds.length > 40 && (
                <span className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-[10px] text-slate-500">
                  +{affectedIds.length - 40} more
                </span>
              )}
              {affectedIds.length === 0 && (
                <span className="text-xs text-slate-600">No pole IDs recorded</span>
              )}
            </div>

            {/* Confidence Reasons */}
            {incident.confidence_reasons && (
              <div className="mt-4">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Confidence Reasons</h4>
                <div className="space-y-1">
                  {(Array.isArray(incident.confidence_reasons)
                    ? incident.confidence_reasons
                    : Object.entries(incident.confidence_reasons || {}).map(([k, v]) => `${k}: ${v}`)
                  ).map((r, i) => (
                    <div key={i} className="text-xs text-slate-400 flex items-start gap-1.5">
                      <span className="text-slate-600 mt-0.5">•</span>
                      <span>{typeof r === 'string' ? r : JSON.stringify(r)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ incidents }) {
  const total  = incidents.length;
  const byType = incidents.reduce((acc, i) => { acc[i.type] = (acc[i.type] || 0) + 1; return acc; }, {});
  const byConf = incidents.reduce((acc, i) => { acc[i.confidence] = (acc[i.confidence] || 0) + 1; return acc; }, {});
  const avgAffected = total > 0 ? Math.round(incidents.reduce((s, i) => s + i.affected_count, 0) / total) : 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
      {[
        { label: 'Total Resolved', value: total, icon: CheckCircle2, color: 'text-emerald-400' },
        { label: 'Span / DT / Feeder / Range',
          value: `${byType.SPAN||0} / ${byType.DT||0} / ${byType.FEEDER||0} / ${byType.RANGE||0}`,
          icon: Layers, color: 'text-blue-400' },
        { label: 'High / Med / Low',
          value: `${byConf.HIGH||0} / ${byConf.MEDIUM||0} / ${byConf.LOW||0}`,
          icon: BarChart2, color: 'text-yellow-400' },
        { label: 'Avg Poles Affected', value: avgAffected, icon: Zap, color: 'text-purple-400' },
      ].map(s => (
        <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 flex items-center gap-3">
          <s.icon className={`w-5 h-5 flex-shrink-0 ${s.color}`} />
          <div>
            <div className="text-lg font-bold text-white">{s.value}</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide">{s.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function IncidentHistoryPanel({ onClose }) {
  const [data, setData]         = useState({ incidents: [], total: 0 });
  const [isLoading, setLoading] = useState(true);
  const [error, setError]       = useState(null);
  const [search, setSearch]     = useState('');
  const [typeFilter, setTypeFilter]   = useState('ALL');
  const [confFilter, setConfFilter]   = useState('ALL');
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

  const filtered = data.incidents.filter(i => {
    if (stateFilter !== 'ALL' && i.ticket?.state !== stateFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      i.id.toLowerCase().includes(q) ||
      (i.upstream_live_pole_id || '').toLowerCase().includes(q) ||
      i.type.toLowerCase().includes(q)
    );
  });

  return (
    <div className="absolute inset-0 bg-slate-950 z-[2000] flex flex-col overflow-hidden">

      {/* Header */}
      <header className="h-16 flex-shrink-0 border-b border-slate-800 px-6 flex items-center justify-between bg-slate-900">
        <div className="flex items-center gap-3">
          <History className="w-6 h-6 text-indigo-400" />
          <div>
            <h1 className="text-lg font-bold text-white">Incident History</h1>
            <p className="text-xs text-slate-500">{data.total} resolved / verified incidents</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={load}
            disabled={isLoading}
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors"
          >
            Back to Map
          </button>
        </div>
      </header>

      {/* Toolbar */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-slate-800 bg-slate-900/50 flex flex-wrap gap-3 items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search by pole ID, incident ID, or type…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-500" />
          {[
            { label: 'Type', value: typeFilter, set: setTypeFilter, opts: ['ALL','SPAN','DT','FEEDER','RANGE'] },
            { label: 'Confidence', value: confFilter, set: setConfFilter, opts: ['ALL','HIGH','MEDIUM','LOW'] },
            { label: 'State', value: stateFilter, set: setStateFilter, opts: ['ALL','VERIFIED','RESOLVED','CLOSED'] },
          ].map(f => (
            <select
              key={f.label}
              value={f.value}
              onChange={e => f.set(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            >
              {f.opts.map(o => (
                <option key={o} value={o}>{o === 'ALL' ? `All ${f.label}s` : o}</option>
              ))}
            </select>
          ))}
        </div>

        <div className="text-xs text-slate-500 ml-auto">
          {filtered.length} of {data.total} shown
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
        {isLoading ? (
          <div className="h-full flex items-center justify-center gap-3 text-slate-500">
            <RefreshCw className="w-5 h-5 animate-spin" />
            Loading history…
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
              <p className="text-red-400 text-sm">{error}</p>
              <button onClick={load} className="mt-3 text-xs text-slate-400 hover:text-white">Retry</button>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3">
            <History className="w-12 h-12 opacity-20" />
            <p className="text-sm">No resolved incidents yet.</p>
            <p className="text-xs text-slate-600">Inject and repair a fault to see history here.</p>
          </div>
        ) : (
          <>
            <StatsBar incidents={filtered} />
            <div className="space-y-2">
              {filtered.map(i => <HistoryRow key={i.id} incident={i} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
