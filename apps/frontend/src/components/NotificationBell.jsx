import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, AlertTriangle, Zap, Clock } from 'lucide-react';
import { getIncidentLabel } from '../utils/incidentLabel';

export default function NotificationBell({ incidents, onSelectIncident }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const unacknowledged = useMemo(() => {
    return (incidents || [])
      .filter((i) => i.ticket?.state === 'DETECTED')
      .sort((a, b) => new Date(b.first_detected_at) - new Date(a.first_detected_at));
  }, [incidents]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const handleEscape = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 text-slate-400 hover:text-slate-200 transition-colors rounded-lg hover:bg-slate-800"
        aria-label={`${unacknowledged.length} unacknowledged incidents`}
      >
        <Bell className="w-5 h-5" />
        {unacknowledged.length > 0 && (
          <>
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full animate-ping"></span>
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full"></span>
          </>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto custom-scrollbar glass-panel rounded-xl shadow-2xl border border-slate-700/80 z-[2500]">
          <div className="p-3 border-b border-slate-700/50 flex items-center justify-between sticky top-0 bg-slate-900/90 backdrop-blur-md">
            <span className="text-sm font-semibold text-slate-200">Unacknowledged Faults</span>
            <span className="text-xs text-slate-500">{unacknowledged.length}</span>
          </div>

          {unacknowledged.length === 0 ? (
            <div className="p-6 text-center">
              <Bell className="w-6 h-6 text-slate-700 mx-auto mb-2" />
              <p className="text-xs text-slate-500">All incidents have been acknowledged.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {unacknowledged.slice(0, 20).map((incident) => (
                <button
                  key={incident.id}
                  onClick={() => {
                    onSelectIncident(incident.id);
                    setOpen(false);
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-slate-800/60 transition-colors flex items-start gap-3"
                >
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-200 font-medium truncate">
                      {incident.type} FAULT — {getIncidentLabel(incident)}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                      <span className="flex items-center gap-1"><Zap className="w-3 h-3" />{incident.affected_count} poles</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(incident.first_detected_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
