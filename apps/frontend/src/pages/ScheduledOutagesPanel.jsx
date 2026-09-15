import React, { useState, useMemo } from 'react';
import { X, Calendar, Plus, Clock, CheckCircle, AlertCircle, Info } from 'lucide-react';

const SCOPE_COLORS = {
  DT: { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/30', dot: 'bg-blue-500' },
  FEEDER: { bg: 'bg-purple-500/15', text: 'text-purple-400', border: 'border-purple-500/30', dot: 'bg-purple-500' },
  SPAN: { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30', dot: 'bg-amber-500' },
};

function statusBadge(outage) {
  const now = new Date();
  const start = new Date(outage.start);
  const end = new Date(outage.end);
  if (now < start) return { label: 'UPCOMING', cls: 'bg-sky-500/20 text-sky-300 border-sky-500/40' };
  if (now <= end) return { label: 'ACTIVE', cls: 'bg-green-500/20 text-green-300 border-green-500/40 animate-pulse' };
  return { label: 'EXPIRED', cls: 'bg-slate-700/60 text-slate-400 border-slate-600/40' };
}

function formatDt(iso) {
  return new Date(iso).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: true,
  });
}

// --- Create Outage Form ---
function CreateOutageForm({ mapData, createOutage, onCreated, onCancel }) {
  const feeders = useMemo(() => mapData?.feeders ?? [], [mapData]);
  const transformers = useMemo(() => mapData?.transformers ?? [], [mapData]);

  const [scope, setScope] = useState('DT');
  const [targetId, setTargetId] = useState('');
  const [reason, setReason] = useState('');
  const [startLocal, setStartLocal] = useState('');
  const [endLocal, setEndLocal] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const targetOptions = useMemo(() => {
    if (scope === 'DT') return transformers.map(t => ({ value: t.id, label: t.id }));
    if (scope === 'FEEDER') return feeders.map(f => ({ value: f.id, label: f.name || f.id }));
    return []; // SPAN requires a pole id — free text
  }, [scope, transformers, feeders]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);
    if (!targetId.trim()) return setFormError('Target ID is required.');
    if (!startLocal || !endLocal) return setFormError('Start and End dates are required.');
    if (new Date(startLocal) >= new Date(endLocal)) return setFormError('End must be after Start.');

    const payload = {
      id: crypto.randomUUID(),
      scope,
      target_id: targetId.trim(),
      start: new Date(startLocal).toISOString(),
      end: new Date(endLocal).toISOString(),
      reason: reason.trim() || 'Planned maintenance',
      fetched_at: new Date().toISOString(),
    };

    setSubmitting(true);
    try {
      await createOutage(payload);
      onCreated?.();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-slate-900/80 border border-slate-700/60 rounded-2xl p-5 shadow-2xl">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-slate-200 flex items-center gap-2">
          <Plus className="w-4 h-4 text-emerald-400" /> Schedule New Outage
        </h3>
        <button onClick={onCancel} className="text-slate-500 hover:text-slate-300 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Scope */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Scope</label>
          <div className="flex gap-2">
            {['DT', 'FEEDER', 'SPAN'].map(s => {
              const c = SCOPE_COLORS[s];
              return (
                <button
                  key={s} type="button"
                  onClick={() => { setScope(s); setTargetId(''); }}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    scope === s
                      ? `${c.bg} ${c.text} ${c.border}`
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600'
                  }`}
                >{s}</button>
              );
            })}
          </div>
        </div>

        {/* Target ID */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Target {scope} ID</label>
          {scope === 'SPAN' ? (
            <input
              type="text"
              value={targetId}
              onChange={e => setTargetId(e.target.value)}
              placeholder="e.g. pole-1042"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          ) : (
            <select
              value={targetId}
              onChange={e => setTargetId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">-- Select {scope} --</option>
              {targetOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          )}
        </div>

        {/* Date-time range */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Start</label>
            <input
              type="datetime-local"
              value={startLocal}
              onChange={e => setStartLocal(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">End</label>
            <input
              type="datetime-local"
              value={endLocal}
              onChange={e => setEndLocal(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Reason */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Reason</label>
          <input
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g. Annual transformer maintenance"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {formError && (
          <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            {formError}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button" onClick={onCancel}
            className="flex-1 py-2 rounded-lg text-sm font-medium bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-colors"
          >Cancel</button>
          <button
            type="submit" disabled={submitting}
            className="flex-1 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Scheduling...' : 'Schedule Outage'}
          </button>
        </div>
      </form>
    </div>
  );
}

// --- Single Outage Card ---
function OutageCard({ outage }) {
  const status = statusBadge(outage);
  const c = SCOPE_COLORS[outage.scope] || SCOPE_COLORS.DT;

  return (
    <div className={`border rounded-xl p-4 transition-all ${c.border} bg-slate-900/50`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`flex-shrink-0 w-2 h-2 rounded-full ${c.dot}`} />
          <span className={`text-xs font-bold uppercase tracking-wider ${c.text} flex-shrink-0`}>{outage.scope}</span>
          <span className="text-sm font-mono text-slate-300 truncate">{outage.target_id}</span>
        </div>
        <span className={`flex-shrink-0 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${status.cls}`}>
          {status.label}
        </span>
      </div>

      <p className="mt-2 text-xs text-slate-400 line-clamp-2">{outage.reason}</p>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3 flex-shrink-0 text-slate-600" />
          <span>{formatDt(outage.start)}</span>
        </div>
        <div className="flex items-center gap-1">
          <CheckCircle className="w-3 h-3 flex-shrink-0 text-slate-600" />
          <span>{formatDt(outage.end)}</span>
        </div>
      </div>
    </div>
  );
}

// --- Main Panel ---
export default function ScheduledOutagesPanel({ onClose, mapData, outages, isLoading, error, createOutage }) {
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('ALL');

  const activeCount = useMemo(() => {
    const now = new Date();
    return outages.filter(o => new Date(o.start) <= now && now <= new Date(o.end)).length;
  }, [outages]);

  const upcomingCount = useMemo(() => {
    const now = new Date();
    return outages.filter(o => new Date(o.start) > now).length;
  }, [outages]);

  const filtered = useMemo(() => {
    const now = new Date();
    return outages.filter(o => {
      const s = new Date(o.start), e = new Date(o.end);
      if (filter === 'ACTIVE') return s <= now && now <= e;
      if (filter === 'UPCOMING') return s > now;
      if (filter === 'EXPIRED') return now > e;
      return true;
    });
  }, [outages, filter]);

  return (
    <div className="fixed inset-0 z-[2000] flex items-stretch justify-end pointer-events-none">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm pointer-events-auto"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-md h-full bg-slate-950/95 border-l border-slate-800 flex flex-col shadow-2xl pointer-events-auto">
        {/* Header */}
        <div className="flex-shrink-0 px-5 py-4 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/15 rounded-lg">
              <Calendar className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-200">Scheduled Outages</h2>
              <p className="text-xs text-slate-500">
                {activeCount} active · {upcomingCount} upcoming
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowForm(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-white transition-colors border border-emerald-500/50"
            >
              <Plus className="w-3.5 h-3.5" /> Schedule
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-500 hover:text-slate-300 rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Info Banner */}
        <div className="flex-shrink-0 mx-4 mt-4 flex items-start gap-2 bg-indigo-500/10 border border-indigo-500/25 rounded-xl px-4 py-3 text-xs text-indigo-300">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-indigo-400" />
          <span>
            When a fault overlaps with an active scheduled outage, the system lowers its confidence score so operators aren't alarmed by maintenance activity.
          </span>
        </div>

        {/* Create Form */}
        {showForm && (
          <div className="flex-shrink-0 mx-4 mt-4">
            <CreateOutageForm
              mapData={mapData}
              createOutage={createOutage}
              onCreated={() => setShowForm(false)}
              onCancel={() => setShowForm(false)}
            />
          </div>
        )}

        {/* Filters */}
        <div className="flex-shrink-0 px-4 pt-4 pb-2 flex gap-2">
          {['ALL', 'ACTIVE', 'UPCOMING', 'EXPIRED'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wider transition-all ${
                filter === f
                  ? 'bg-indigo-600/80 text-indigo-100 border border-indigo-500/60'
                  : 'text-slate-500 border border-slate-800 hover:border-slate-700 hover:text-slate-400'
              }`}
            >{f}</button>
          ))}
        </div>

        {/* Outage List */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3 custom-scrollbar">
          {isLoading && (
            <div className="flex flex-col items-center justify-center pt-16 gap-3 text-slate-600">
              <div className="w-8 h-8 border-2 border-slate-700 border-t-indigo-500 rounded-full animate-spin" />
              <span className="text-sm">Loading outages…</span>
            </div>
          )}

          {error && !isLoading && (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mt-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {!isLoading && !error && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center pt-20 gap-3 text-slate-600">
              <Calendar className="w-12 h-12 text-slate-800" />
              <div className="text-center">
                <p className="text-sm font-medium text-slate-500">No {filter !== 'ALL' ? filter.toLowerCase() : ''} outages</p>
                <p className="text-xs text-slate-600 mt-1">
                  {filter === 'ALL' ? 'Click "Schedule" to plan a new outage.' : 'Try a different filter.'}
                </p>
              </div>
            </div>
          )}

          {!isLoading && filtered.map(outage => (
            <OutageCard key={outage.id} outage={outage} />
          ))}
        </div>
      </div>
    </div>
  );
}
