import React, { useMemo, useState } from 'react';
import { AlertTriangle, Clock, Zap, Target, Activity, ShieldAlert, Search, X, ArrowUpDown } from 'lucide-react';
import { getIncidentLabel } from '../utils/incidentLabel';

const TYPE_OPTS = ['ALL', 'SPAN', 'DT', 'FEEDER', 'RANGE'];
const CONF_OPTS = ['ALL', 'HIGH', 'MEDIUM', 'LOW'];

const SORTERS = {
  NEWEST: (a, b) => new Date(b.first_detected_at) - new Date(a.first_detected_at),
  OLDEST: (a, b) => new Date(a.first_detected_at) - new Date(b.first_detected_at),
  MOST_AFFECTED: (a, b) => (b.affected_count || 0) - (a.affected_count || 0),
};

export default function IncidentList({ incidents, isLoading, error, selectedIncidentId, onSelectIncident }) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [confFilter, setConfFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('NEWEST');

  const filtered = useMemo(() => {
    if (!incidents) return [];
    const q = search.trim().toLowerCase();
    return incidents
      .filter((i) => {
        if (typeFilter !== 'ALL' && i.type !== typeFilter) return false;
        if (confFilter !== 'ALL' && i.confidence !== confFilter) return false;
        if (!q) return true;
        return (
          i.id.toLowerCase().includes(q) ||
          (i.upstream_live_pole_id || '').toLowerCase().includes(q) ||
          i.type.toLowerCase().includes(q) ||
          (i.ticket?.id || '').toLowerCase().includes(q)
        );
      })
      .sort(SORTERS[sortBy]);
  }, [incidents, search, typeFilter, confFilter, sortBy]);

  const hasActiveFilters = search || typeFilter !== 'ALL' || confFilter !== 'ALL';

  const clearFilters = () => {
    setSearch('');
    setTypeFilter('ALL');
    setConfFilter('ALL');
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        <p className="text-slate-400 font-medium animate-pulse">Loading active incidents...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel p-6 rounded-xl bg-red-900/20 border-red-500/30 flex items-start space-x-4">
        <ShieldAlert className="w-6 h-6 text-red-400 mt-1 flex-shrink-0" />
        <div>
          <h3 className="text-lg font-semibold text-red-300">Connection Error</h3>
          <p className="text-slate-300 mt-1">{error}</p>
          <p className="text-sm text-slate-400 mt-2">Retrying automatically...</p>
        </div>
      </div>
    );
  }

  if (!incidents || incidents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 glass-panel rounded-xl text-center p-8">
        <div className="bg-green-500/10 p-4 rounded-full mb-4">
          <Activity className="w-8 h-8 text-green-400" />
        </div>
        <h3 className="text-xl font-semibold text-slate-200">Network is Stable</h3>
        <p className="text-slate-400 mt-2 max-w-md">
          There are currently no active fault incidents detected on the grid. The localization engine is continuously monitoring telemetry.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <AlertTriangle className="text-amber-500 w-6 h-6" />
          Active Incidents
          <span className="ml-2 bg-slate-800 text-slate-300 text-sm py-1 px-3 rounded-full border border-slate-700">
            {incidents.length}
          </span>
        </h2>
      </div>

      {/* Search + Filter Toolbar */}
      <div className="space-y-2 sticky top-0 z-10 bg-slate-950/0 pb-1">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search by pole ID, incident ID, or type…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-8 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            {TYPE_OPTS.map((o) => (
              <option key={o} value={o}>{o === 'ALL' ? 'All Types' : o}</option>
            ))}
          </select>
          <select
            value={confFilter}
            onChange={(e) => setConfFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            {CONF_OPTS.map((o) => (
              <option key={o} value={o}>{o === 'ALL' ? 'All Confidence' : o}</option>
            ))}
          </select>
          <button
            onClick={() => setSortBy(sortBy === 'NEWEST' ? 'MOST_AFFECTED' : sortBy === 'MOST_AFFECTED' ? 'OLDEST' : 'NEWEST')}
            className="flex items-center gap-1.5 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 hover:text-white hover:border-slate-600 transition-colors"
            title="Change sort order"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            {sortBy === 'NEWEST' ? 'Newest' : sortBy === 'MOST_AFFECTED' ? 'Most Affected' : 'Oldest'}
          </button>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-slate-500 hover:text-slate-300 ml-auto"
            >
              Clear filters
            </button>
          )}
        </div>

        {hasActiveFilters && (
          <div className="text-xs text-slate-500">
            {filtered.length} of {incidents.length} shown
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 glass-panel rounded-xl text-center p-8">
          <Search className="w-8 h-8 text-slate-600 mb-3" />
          <h3 className="text-sm font-semibold text-slate-300">No incidents match your filters</h3>
          <button onClick={clearFilters} className="text-xs text-blue-400 hover:text-blue-300 mt-2">
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map((incident) => {
            const isSelected = selectedIncidentId === incident.id;
            return (
              <div
                key={incident.id}
                onClick={() => onSelectIncident(incident.id)}
                className={`cursor-pointer glass-panel rounded-xl p-5 transition-all duration-300 group flex flex-col md:flex-row md:items-center justify-between gap-4 border-l-4
                ${isSelected ? 'border-blue-500 bg-slate-800 ring-2 ring-blue-500/50' : 'border-l-red-500 hover:bg-slate-800/80'}
              `}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`px-2.5 py-1 text-xs font-bold uppercase tracking-wider rounded border
                    ${isSelected ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' : 'bg-red-500/20 text-red-400 border-red-500/20'}
                  `}>
                      {incident.type} FAULT
                    </span>
                    <span className="text-sm text-slate-400 font-mono">
                      {incident.id.split('-')[0]}
                    </span>
                  </div>

                  <h3 className="text-lg font-semibold text-slate-200 mt-1">
                    {incident.upstream_live_pole_id ? 'Upstream Target: ' : ''}
                    <span className="text-white font-mono">{getIncidentLabel(incident)}</span>
                  </h3>

                  <div className="flex flex-wrap items-center gap-4 mt-3 text-sm text-slate-400">
                    <div className="flex items-center gap-1.5" title="Confidence Level">
                      <Target className="w-4 h-4 text-slate-500" />
                      <span className={incident.confidence === 'HIGH' ? 'text-green-400' : 'text-amber-400'}>
                        {incident.confidence} Confidence
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5" title="Affected Poles">
                      <Zap className="w-4 h-4 text-slate-500" />
                      <span>{incident.affected_count} Poles Affected</span>
                    </div>

                    <div className="flex items-center gap-1.5" title="First Detected">
                      <Clock className="w-4 h-4 text-slate-500" />
                      <span>
                        {new Date(incident.first_detected_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </div>

                {incident.ticket && (
                  <div className="flex flex-col items-end shrink-0 pl-4 border-t md:border-t-0 md:border-l border-slate-700/50 pt-4 md:pt-0">
                    <span className="text-xs text-slate-500 uppercase tracking-wider mb-1">Ticket State</span>
                    <span className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                      incident.ticket.state === 'DETECTED' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                        incident.ticket.state === 'RESOLVED' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
                          'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                    }`}>
                      {incident.ticket.state}
                    </span>
                    <span className="text-xs text-slate-500 font-mono mt-2">
                      #{incident.ticket.id.substring(0, 8)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
