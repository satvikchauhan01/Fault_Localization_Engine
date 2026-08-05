import React, { useState, useMemo } from 'react';
import { useSimulator } from '../hooks/useSimulator';
import { useMapData } from '../hooks/useMapData';
import { TestTube, Zap, Activity, ShieldAlert, Loader2, Play, Wrench, RefreshCw, Layers } from 'lucide-react';

export default function SimulatorPanel({ onClose, onInjectionSuccess }) {
  const { faults, injectFault, repairFault, isLoading: isSimulatorLoading } = useSimulator(3000);
  const { mapData, isLoading: isMapLoading } = useMapData();

  const [type, setType] = useState('SPAN');
  const [target, setTarget] = useState('');
  const [duplicates, setDuplicates] = useState(false);
  const [reorder, setReorder] = useState(false);
  const [isInjecting, setIsInjecting] = useState(false);
  const [injectError, setInjectError] = useState(null);
  const [repairingId, setRepairingId] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = (message) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Available targets based on selected type
  const availableTargets = useMemo(() => {
    if (isMapLoading || !mapData) return [];
    
    if (type === 'SPAN') {
      return mapData.poles.map(p => ({ id: p.id, label: `Pole ${p.id}` }));
    } else if (type === 'DT') {
      return mapData.transformers.map(t => ({ id: t.id, label: `DT ${t.id}` }));
    } else if (type === 'FEEDER') {
      return mapData.feeders.map(f => ({ id: f.id, label: `Feeder ${f.name || f.id}` }));
    }
    return [];
  }, [type, mapData, isMapLoading]);

  // Reset target when type changes
  React.useEffect(() => {
    setTarget('');
  }, [type]);

  const handleInject = async (e) => {
    e.preventDefault();
    if (!target) return;
    
    setIsInjecting(true);
    setInjectError(null);
    try {
      await injectFault({ type, target, duplicates, reorder });
      
      // Notify parent to handle auto-guidance
      if (onInjectionSuccess) {
        onInjectionSuccess();
      } else {
        // Reset form if we didn't navigate away
        setTarget('');
        setDuplicates(false);
        setReorder(false);
      }
    } catch (err) {
      setInjectError(err.message);
    } finally {
      setIsInjecting(false);
    }
  };

  const handleRepair = async (faultId) => {
    setRepairingId(faultId);
    try {
      await repairFault(faultId);
      showToast('Repair initiated.\nWaiting for restoration telemetry...');
    } catch (err) {
      console.error('Repair failed:', err);
    } finally {
      setRepairingId(null);
    }
  };

  return (
    <div className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm z-[2000] overflow-y-auto">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-4 right-4 z-[3000] bg-slate-800 border border-slate-700 text-slate-200 px-4 py-3 rounded-lg shadow-2xl animate-in slide-in-from-bottom-4 flex items-start gap-3">
          <Activity className="w-5 h-5 text-blue-400 mt-0.5" />
          <div className="whitespace-pre-line text-sm">{toastMessage}</div>
        </div>
      )}
      
      <div className="max-w-4xl mx-auto py-12 px-6">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <TestTube className="w-8 h-8 text-blue-400" />
              Fault Simulator
            </h1>
            <p className="text-slate-400 mt-2">
              Inject hardware faults to test the localization engine and telemetry processing.
            </p>
          </div>
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors font-medium"
          >
            Back to Map
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Inject Fault Form */}
          <div className="glass-panel rounded-xl border border-slate-700/80 overflow-hidden shadow-2xl">
            <div className="bg-slate-800/80 p-4 border-b border-slate-700/50 flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400" />
              <h2 className="font-semibold text-lg">Inject New Fault</h2>
            </div>
            
            <form onSubmit={handleInject} className="p-6 space-y-6">
              
              {injectError && (
                <div className="p-3 bg-red-900/30 border border-red-500/50 rounded-lg text-red-400 text-sm flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  {injectError}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Fault Type</label>
                  <select 
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  >
                    <option value="SPAN">SPAN</option>
                    <option value="DT">DT</option>
                    <option value="FEEDER">FEEDER</option>
                  </select>
                  <p className="mt-2 text-xs text-slate-400">
                    {type === 'SPAN' && "A span fault disconnects a section of line. All downstream poles on that span lose power."}
                    {type === 'DT' && "A distribution transformer fault affects all poles supplied by the selected transformer."}
                    {type === 'FEEDER' && "A feeder fault affects every distribution transformer and pole connected to the selected feeder."}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Target Equipment</label>
                  <select 
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    disabled={isMapLoading || availableTargets.length === 0}
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50"
                  >
                    <option value="">Select a target...</option>
                    {availableTargets.map(t => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-3 bg-slate-900/50 p-4 rounded-lg border border-slate-700/50">
                <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-3">
                  <Activity className="w-4 h-4" /> Telemetry Noise Simulation
                </h3>
                
                <label className="flex items-start gap-3 cursor-pointer group">
                  <div className="relative flex items-center pt-0.5">
                    <input 
                      type="checkbox" 
                      checked={duplicates}
                      onChange={(e) => setDuplicates(e.target.checked)}
                      className="peer sr-only"
                    />
                    <div className="w-5 h-5 border-2 border-slate-600 rounded bg-slate-800 peer-checked:bg-blue-500 peer-checked:border-blue-500 transition-colors"></div>
                    <svg className="absolute w-5 h-5 text-white pointer-events-none opacity-0 peer-checked:opacity-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </div>
                  <div>
                    <span className="text-sm text-slate-200 group-hover:text-white transition-colors block">Duplicate Packets</span>
                    <span className="text-xs text-slate-500">Simulates packet re-transmission and bounce.</span>
                  </div>
                </label>
                
                <label className="flex items-start gap-3 cursor-pointer group">
                  <div className="relative flex items-center pt-0.5">
                    <input 
                      type="checkbox" 
                      checked={reorder}
                      onChange={(e) => setReorder(e.target.checked)}
                      className="peer sr-only"
                    />
                    <div className="w-5 h-5 border-2 border-slate-600 rounded bg-slate-800 peer-checked:bg-blue-500 peer-checked:border-blue-500 transition-colors"></div>
                    <svg className="absolute w-5 h-5 text-white pointer-events-none opacity-0 peer-checked:opacity-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </div>
                  <div>
                    <span className="text-sm text-slate-200 group-hover:text-white transition-colors block">Out-of-Order Delivery</span>
                    <span className="text-xs text-slate-500">Simulates variable network latency.</span>
                  </div>
                </label>
              </div>

              <button 
                type="submit"
                disabled={isInjecting || !target}
                className="w-full py-3 px-4 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-medium transition-all focus:ring-4 focus:ring-amber-500/50 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-amber-900/20"
              >
                {isInjecting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-current" />}
                {isInjecting ? 'Injecting...' : 'Inject Fault'}
              </button>

            </form>
          </div>

          {/* Active Faults List */}
          <div className="glass-panel rounded-xl border border-slate-700/80 overflow-hidden shadow-2xl flex flex-col h-[600px]">
            <div className="bg-slate-800/80 p-4 border-b border-slate-700/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-blue-400" />
                <h2 className="font-semibold text-lg">Active Faults</h2>
              </div>
              <div className="text-xs bg-slate-900 px-2.5 py-1 rounded-full border border-slate-700 text-slate-400">
                {faults.length} Active
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
              {isSimulatorLoading && faults.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3">
                  <RefreshCw className="w-6 h-6 animate-spin" />
                  <p>Loading faults...</p>
                </div>
              ) : faults.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3">
                  <ShieldAlert className="w-8 h-8 opacity-20" />
                  <p>No active faults.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {faults.map(fault => (
                    <div key={fault.id} className="p-4 rounded-lg bg-slate-800/50 border border-slate-700/50 flex items-center justify-between hover:bg-slate-800 transition-colors">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-slate-900 border ${
                            fault.type === 'FEEDER' ? 'text-purple-400 border-purple-500/30' :
                            fault.type === 'DT' ? 'text-orange-400 border-orange-500/30' :
                            'text-blue-400 border-blue-500/30'
                          }`}>
                            {fault.type}
                          </span>
                          <span className="font-mono text-sm text-slate-200">{fault.target}</span>
                        </div>
                        <p className="text-xs text-slate-500 font-mono">ID: {fault.id.substring(0,8)}</p>
                      </div>
                      
                      <button
                        onClick={() => handleRepair(fault.id)}
                        disabled={repairingId === fault.id}
                        className="px-3 py-1.5 bg-green-600/20 hover:bg-green-600/30 text-green-400 border border-green-500/30 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {repairingId === fault.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Wrench className="w-4 h-4" />
                        )}
                        Repair
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
