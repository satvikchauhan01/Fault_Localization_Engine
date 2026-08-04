import React from 'react';
import { useIncidents } from '../hooks/useIncidents';
import { AlertTriangle, Clock, Zap, Target, Activity, ShieldAlert } from 'lucide-react';

export default function IncidentList() {
  const { incidents, isLoading, error } = useIncidents(3000);

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
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <AlertTriangle className="text-amber-500 w-6 h-6" />
          Active Incidents
          <span className="ml-2 bg-slate-800 text-slate-300 text-sm py-1 px-3 rounded-full border border-slate-700">
            {incidents.length}
          </span>
        </h2>
      </div>
      
      <div className="grid gap-4">
        {incidents.map((incident) => (
          <div 
            key={incident.id} 
            className="glass-panel rounded-xl p-5 hover:bg-slate-800/80 transition-all duration-300 group flex flex-col md:flex-row md:items-center justify-between gap-4 border-l-4 border-l-red-500"
          >
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <span className="px-2.5 py-1 text-xs font-bold uppercase tracking-wider rounded bg-red-500/20 text-red-400 border border-red-500/20">
                  {incident.type} FAULT
                </span>
                <span className="text-sm text-slate-400 font-mono">
                  {incident.id.split('-')[0]}
                </span>
              </div>
              
              <h3 className="text-lg font-semibold text-slate-200 mt-1">
                Upstream Target: <span className="text-white font-mono">{incident.upstream_live_pole_id}</span>
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
        ))}
      </div>
    </div>
  );
}
