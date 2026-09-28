import React, { useMemo, useState } from 'react';
import { Activity, ShieldAlert, Search, X, ArrowUpDown } from 'lucide-react';
import { locateFault } from '../utils/networkModel';
import { getIncidentLabel } from '../utils/incidentLabel';

const TYPE_OPTS = ['ALL', 'SPAN', 'DT', 'FEEDER', 'RANGE'];
const CONF_OPTS = ['ALL', 'HIGH', 'MEDIUM', 'LOW'];

const SORTERS = {
  NEWEST: (a, b) => new Date(b.first_detected_at) - new Date(a.first_detected_at),
  OLDEST: (a, b) => new Date(a.first_detected_at) - new Date(b.first_detected_at),
  MOST_AFFECTED: (a, b) => (b.affected_count || 0) - (a.affected_count || 0),
};
const SORT_LABEL = { NEWEST: 'Newest', MOST_AFFECTED: 'Most affected', OLDEST: 'Oldest' };
const NEXT_SORT = { NEWEST: 'MOST_AFFECTED', MOST_AFFECTED: 'OLDEST', OLDEST: 'NEWEST' };

const CONF_DOT = { HIGH: 'bg-emerald-400', MEDIUM: 'bg-amber-400', LOW: 'bg-red-400' };
const STATE_STYLE = {
  DETECTED: 'text-red-300 border-red-900 bg-red-950/60',
  ACKNOWLEDGED: 'text-amber-300 border-amber-900 bg-amber-950/60',
  CREW_ASSIGNED: 'text-blue-300 border-blue-900 bg-blue-950/60',
  RESOLVED: 'text-emerald-300 border-emerald-900 bg-emerald-950/60',
};
const STATE_LABEL = { DETECTED: 'New', ACKNOWLEDGED: 'Acknowledged', CREW_ASSIGNED: 'Crew out', RESOLVED: 'Repaired' };

function timeAgo(iso) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.floor(hrs / 24)} d ago`;
}

const selectClass = 'bg-slate-900 border border-slate-700 rounded-md px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/50';

export default function IncidentList({ incidents, index, isLoading, error, selectedIncidentId, onSelectIncident }) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [confFilter, setConfFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('NEWEST');

  const titles = useMemo(() => {
    const m = new Map();
    for (const inc of incidents || []) m.set(inc.id, locateFault(inc, index)?.title || getIncidentLabel(inc));
    return m;
  }, [incidents, index]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (incidents || [])
      .filter((i) => {
        if (typeFilter !== 'ALL' && i.type !== typeFilter) return false;
        if (confFilter !== 'ALL' && i.confidence !== confFilter) return false;
        if (!q) return true;
        const affected = i.affected_pole_ids || [];
        return (
          i.id.toLowerCase().includes(q) ||
          (i.ticket?.id || '').toLowerCase().includes(q) ||
          i.type.toLowerCase().includes(q) ||
          (titles.get(i.id) || '').toLowerCase().includes(q) ||
          affected.some((id) => id.toLowerCase() === q)
        );
      })
      .sort(SORTERS[sortBy]);
  }, [incidents, search, typeFilter, confFilter, sortBy, titles]);

  const hasActiveFilters = search || typeFilter !== 'ALL' || confFilter !== 'ALL';
  const clearFilters = () => {
    setSearch('');
    setTypeFilter('ALL');
    setConfFilter('ALL');
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 pt-3 pb-2 border-b border-slate-800 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">Active incidents</h2>
          <span className="text-xs text-slate-500">
            {hasActiveFilters ? `${filtered.length} of ${incidents?.length || 0}` : incidents?.length || 0}
          </span>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search pole, DT, ticket..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-7 py-1.5 bg-slate-900 border border-slate-700 rounded-md text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300" aria-label="Clear search">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={selectClass} aria-label="Fault type">
            {TYPE_OPTS.map((o) => <option key={o} value={o}>{o === 'ALL' ? 'All types' : o}</option>)}
          </select>
          <select value={confFilter} onChange={(e) => setConfFilter(e.target.value)} className={selectClass} aria-label="Confidence">
            {CONF_OPTS.map((o) => <option key={o} value={o}>{o === 'ALL' ? 'Any confidence' : o}</option>)}
          </select>
          <button
            onClick={() => setSortBy(NEXT_SORT[sortBy])}
            className={`${selectClass} flex items-center gap-1 ml-auto hover:text-white`}
            title="Change sort order"
          >
            <ArrowUpDown className="w-3 h-3" /> {SORT_LABEL[sortBy]}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
            <p className="text-sm text-slate-500">Loading incidents...</p>
          </div>
        ) : error ? (
          <div className="m-3 p-3 rounded-md border border-red-900 bg-red-950/40 flex gap-2">
            <ShieldAlert className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="text-red-300 font-medium">Cannot reach the backend</p>
              <p className="text-slate-400 text-xs mt-0.5">{error}. Retrying automatically.</p>
            </div>
          </div>
        ) : !incidents || incidents.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center px-6 py-12">
            <div className="w-10 h-10 rounded-md bg-emerald-950/60 border border-emerald-900 flex items-center justify-center mb-3">
              <Activity className="w-5 h-5 text-emerald-400" />
            </div>
            <p className="text-sm font-medium text-slate-200">No active faults</p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">Every monitored pole is reporting. New faults appear here and on the map.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center px-6 py-12">
            <p className="text-sm text-slate-300">No incidents match these filters.</p>
            <button onClick={clearFilters} className="text-xs text-blue-400 hover:text-blue-300 mt-2">Clear filters</button>
          </div>
        ) : (
          <ul>
            {filtered.map((inc) => {
              const selected = inc.id === selectedIncidentId;
              const state = inc.ticket?.state;
              return (
                <li key={inc.id}>
                  <button
                    onClick={() => onSelectIncident(inc.id)}
                    className={`w-full text-left px-3 py-2.5 border-b border-slate-800/80 border-l-2 transition-colors ${
                      selected ? 'bg-slate-800/80 border-l-blue-500' : 'border-l-transparent hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-red-300 w-12 flex-shrink-0">{inc.type}</span>
                      <span className="text-sm text-slate-100 truncate flex-1">{titles.get(inc.id)}</span>
                      {state && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0 ${STATE_STYLE[state] || 'text-slate-400 border-slate-700'}`}>
                          {STATE_LABEL[state] || state}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 pl-14 text-[11px] text-slate-500">
                      <span className="flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${CONF_DOT[inc.confidence]}`} />
                        {inc.confidence.toLowerCase()}
                      </span>
                      <span>{inc.affected_count} poles</span>
                      <span className="ml-auto">{timeAgo(inc.first_detected_at)}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
