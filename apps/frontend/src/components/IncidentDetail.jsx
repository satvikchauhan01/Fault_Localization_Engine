import React, { useMemo, useEffect, useState } from 'react';
import { useTicketWorkflow } from '../hooks/useTicketWorkflow';
import { X, CheckCircle, ShieldAlert, Loader2, ArrowRight, Zap, Briefcase, Activity, Sparkles } from 'lucide-react';

export default function IncidentDetail({ 
  incidentId, 
  incidents, 
  mapData, 
  onClose 
}) {
  const { transitionTicket, isTransitioning, transitionError, clearError } = useTicketWorkflow();
  
  const incident = incidents?.find(i => i.id === incidentId);

  const [explanation, setExplanation] = useState(null);
  const [isExplaining, setIsExplaining] = useState(true);

  useEffect(() => {
    if (!incidentId) return;
    setIsExplaining(true);
    setExplanation(null);
    fetch(`/api/incidents/${incidentId}/explain`)
      .then(res => res.json())
      .then(data => {
        setExplanation(data.explanation);
      })
      .catch(err => {
        console.error('Failed to fetch explanation', err);
        setExplanation('Failed to load explanation.');
      })
      .finally(() => {
        setIsExplaining(false);
      });
  }, [incidentId]);

  // Calculate live restoration status
  const stillDarkCount = useMemo(() => {
    if (!incident || !incident.affected_pole_ids || !mapData?.poles) return 0;
    
    // Cross-reference incident's affected poles with live topology states
    const darkPoles = mapData.poles.filter(
      p => incident.affected_pole_ids.includes(p.id) && 
           (p.state?.status === 'CONFIRMED_DARK' || p.state?.status === 'CANDIDATE_DARK')
    );
    
    return darkPoles.length;
  }, [incident, mapData?.poles]);

  if (!incident) return null;

  const ticket = incident.ticket;
  const originalCount = incident.affected_count || incident.affected_pole_ids?.length || 0;
  
  // Progress Bar percentage
  const restoredCount = originalCount - stillDarkCount;
  const restorationPercent = originalCount > 0 ? (restoredCount / originalCount) * 100 : 0;
  
  // Next valid state logic
  let nextAction = null;
  let nextState = null;
  let actionIcon = null;

  if (ticket?.state === 'DETECTED') {
    nextState = 'ACKNOWLEDGED';
    nextAction = 'Acknowledge Fault';
    actionIcon = <CheckCircle className="w-4 h-4 mr-2" />;
  } else if (ticket?.state === 'ACKNOWLEDGED') {
    nextState = 'CREW_ASSIGNED';
    nextAction = 'Dispatch Field Crew';
    actionIcon = <Briefcase className="w-4 h-4 mr-2" />;
  } else if (ticket?.state === 'CREW_ASSIGNED') {
    nextState = 'RESOLVED';
    nextAction = 'Mark Resolved';
    actionIcon = <Activity className="w-4 h-4 mr-2" />;
  }

  const handleTransition = async () => {
    if (!nextState) return;
    await transitionTicket(ticket.id, nextState);
    // Note: Since `useIncidents` is polling every 3s, the UI will automatically 
    // update to reflect the new state shortly after the API succeeds.
  };

  return (
    <div className="absolute top-4 right-4 z-[1000] w-96 max-h-[calc(100vh-8rem)] overflow-y-auto custom-scrollbar glass-panel shadow-2xl rounded-xl border border-slate-700/80 animate-in slide-in-from-right-8 duration-300">
      
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-700/50 bg-slate-900/60 backdrop-blur-md rounded-t-xl sticky top-0 z-10">
        <div>
          <span className="px-2.5 py-1 text-xs font-bold uppercase tracking-wider rounded border bg-slate-800 text-slate-300 border-slate-600">
            {incident.type} FAULT
          </span>
          <h2 className="text-lg font-semibold mt-2">
            Target: <span className="font-mono text-blue-400">{incident.upstream_live_pole_id}</span>
          </h2>
        </div>
        <button 
          onClick={onClose}
          className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-full transition-colors self-start"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-5 space-y-6">
        
        {/* AI Explanation Block */}
        <div className="bg-slate-900/70 border border-indigo-500/30 rounded-lg p-4 shadow-inner relative overflow-hidden">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">AI-Enhanced Summary</span>
          </div>
          {isExplaining ? (
            <div className="space-y-2 animate-pulse mt-3">
              <div className="h-3 bg-slate-800 rounded w-full"></div>
              <div className="h-3 bg-slate-800 rounded w-5/6"></div>
              <div className="h-3 bg-slate-800 rounded w-4/6"></div>
            </div>
          ) : (
            <p className="text-sm text-slate-300 leading-relaxed">
              {explanation}
            </p>
          )}
        </div>
        
        {/* Ticket Status Block */}
        <div className="space-y-3">
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-400 uppercase tracking-wider text-xs">Current State</span>
            <span className="font-mono text-xs text-slate-500">#{ticket?.id.substring(0,8)}</span>
          </div>
          
          <div className={`p-4 rounded-lg border flex items-center justify-between ${
            ticket?.state === 'VERIFIED' ? 'bg-green-500/10 border-green-500/30' :
            ticket?.state === 'RESOLVED' ? 'bg-blue-500/10 border-blue-500/30' :
            'bg-slate-800/80 border-slate-700'
          }`}>
            <span className={`font-semibold tracking-wide ${
              ticket?.state === 'VERIFIED' ? 'text-green-400' :
              ticket?.state === 'RESOLVED' ? 'text-blue-400' :
              'text-amber-400'
            }`}>
              {ticket?.state || 'UNKNOWN'}
            </span>
            {ticket?.state === 'VERIFIED' && <CheckCircle className="w-6 h-6 text-green-400" />}
          </div>
        </div>

        {/* Live Restoration Strip */}
        <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/50 shadow-inner relative overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-300 flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              Restoration Status
            </span>
            <span className="text-xs font-mono text-slate-400">
              {stillDarkCount} / {originalCount} Dark
            </span>
          </div>
          
          {/* Progress Bar */}
          <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden flex">
            <div 
              className="h-full bg-green-500 transition-all duration-1000 ease-in-out"
              style={{ width: `${restorationPercent}%` }}
            ></div>
            <div 
              className="h-full bg-red-500 transition-all duration-1000 ease-in-out"
              style={{ width: `${100 - restorationPercent}%` }}
            ></div>
          </div>
          
          {stillDarkCount > 0 ? (
            <p className="text-xs text-amber-400 mt-2 text-right">
              {stillDarkCount} poles still disconnected
            </p>
          ) : (
            <p className="text-xs text-green-400 mt-2 text-right flex items-center justify-end gap-1">
              <CheckCircle className="w-3 h-3" /> Power Restored
            </p>
          )}
        </div>

        {/* Workflow Controls */}
        {ticket?.state !== 'VERIFIED' && ticket?.state !== 'RESOLVED' && (
          <div className="pt-2">
            {transitionError && (
              <div className="mb-4 p-3 bg-red-900/30 border border-red-500/50 rounded-lg flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-red-300 font-medium">Transition Refused</p>
                  <p className="text-xs text-red-400 mt-1">{transitionError}</p>
                </div>
                <button onClick={clearError} className="ml-auto text-red-400 hover:text-red-200">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            
            {nextAction && (
              <button 
                onClick={handleTransition}
                disabled={isTransitioning}
                className="w-full flex items-center justify-center py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-all focus:ring-4 focus:ring-blue-500/50 disabled:opacity-50 disabled:cursor-not-allowed group shadow-lg shadow-blue-900/20"
              >
                {isTransitioning ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    {actionIcon}
                    {nextAction}
                    <ArrowRight className="w-4 h-4 ml-auto opacity-0 group-hover:opacity-100 transition-opacity translate-x-2 group-hover:translate-x-0 duration-300" />
                  </>
                )}
              </button>
            )}
          </div>
        )}
        
        {ticket?.state === 'RESOLVED' && (
          <div className="pt-2 p-4 bg-blue-900/20 border border-blue-500/30 rounded-lg text-center">
            <Loader2 className="w-6 h-6 text-blue-400 animate-spin mx-auto mb-2" />
            <h4 className="text-sm font-medium text-blue-300">Waiting for telemetry confirmation...</h4>
            <p className="text-xs text-slate-400 mt-1">
              Restoration verification in progress. The sweeper will transition this ticket to VERIFIED once telemetry stabilizes.
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
