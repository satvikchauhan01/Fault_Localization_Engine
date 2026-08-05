import React, { useState } from 'react';
import IncidentList from './components/IncidentList';
import MapView from './components/MapView';
import IncidentDetail from './components/IncidentDetail';
import SimulatorPanel from './pages/SimulatorPanel';
import ScheduledOutagesPanel from './pages/ScheduledOutagesPanel';
import IncidentHistoryPanel from './pages/IncidentHistoryPanel';
import { useIncidents } from './hooks/useIncidents';
import { useMapData } from './hooks/useMapData';
import { useSimulator } from './hooks/useSimulator';
import { Activity, Map, Settings, Bell, TestTube, Zap, Calendar, AlertTriangle, Wrench, History } from 'lucide-react';

export default function App() {
  const [selectedIncidentId, setSelectedIncidentId] = useState(null);
  const [showSimulator, setShowSimulator] = useState(false);
  const [showScheduledOutages, setShowScheduledOutages] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [activeNav, setActiveNav] = useState('map');
  
  // Lift the data fetching up so we can share it with MapView and IncidentDetail
  const { incidents } = useIncidents(3000);
  const { mapData, isLoading: mapLoading } = useMapData(5000);
  // Always poll for active simulator faults — surface a banner if any are unrepaired
  const { faults: activeFaults, repairFault } = useSimulator(5000);

  // --- Auto-guidance UI Polish State ---
  const [toastMessage, setToastMessage] = useState(null);
  const [waitingForNewIncident, setWaitingForNewIncident] = useState(false);
  const prevIncidentCountRef = React.useRef(incidents?.length || 0);

  const showAppToast = (message) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 5000);
  };

  const handleInjectionSuccess = () => {
    setShowSimulator(false);
    showAppToast('Fault injected successfully.\nWaiting for telemetry processing...');
    setWaitingForNewIncident(true);
  };

  React.useEffect(() => {
    if (incidents) {
      if (waitingForNewIncident && incidents.length > prevIncidentCountRef.current) {
        // We have a new incident! Since backend sorts by newest first, incidents[0] is the new one.
        setSelectedIncidentId(incidents[0].id);
        setWaitingForNewIncident(false);
      }
      prevIncidentCountRef.current = incidents.length;
    }
  }, [incidents, waitingForNewIncident]);

  return (
    <div className="flex h-screen w-full bg-slate-950 overflow-hidden text-slate-200">
      {/* App-level Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-4 right-4 z-[3000] bg-slate-800 border border-slate-700 text-slate-200 px-4 py-3 rounded-lg shadow-2xl flex items-start gap-3">
          <Activity className="w-5 h-5 text-blue-400 mt-0.5" />
          <div className="whitespace-pre-line text-sm">{toastMessage}</div>
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside className="w-52 flex-shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col z-50">
        {/* Brand */}
        <div className="h-16 flex items-center gap-3 px-5 border-b border-slate-800">
          <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center flex-shrink-0">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-base text-white tracking-tight">KSPDB Engine</span>
        </div>

        <nav className="flex-1 py-4 flex flex-col gap-1 px-3">
          <button
            onClick={() => { setActiveNav('map'); setShowSimulator(false); setShowScheduledOutages(false); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeNav === 'map'
                ? 'bg-blue-500/15 text-blue-400 border border-blue-500/20'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            <Map className="w-5 h-5 flex-shrink-0" />
            Network Map
            {activeNav === 'map' && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-400"></div>}
          </button>

          <button
            onClick={() => { setShowSimulator(true); setShowScheduledOutages(false); setActiveNav('simulator'); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeNav === 'simulator'
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            <TestTube className="w-5 h-5 flex-shrink-0" />
            Simulator
          </button>

          <button
            onClick={() => { setShowScheduledOutages(true); setShowSimulator(false); setActiveNav('outages'); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeNav === 'outages'
                ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/20'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            <Calendar className="w-5 h-5 flex-shrink-0" />
            Scheduled Outages
          </button>

          <button
            onClick={() => { setShowHistory(true); setShowSimulator(false); setShowScheduledOutages(false); setActiveNav('history'); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeNav === 'history'
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            <History className="w-5 h-5 flex-shrink-0" />
            Incident History
          </button>

          <div className="mt-auto pt-4 border-t border-slate-800">
            <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors">
              <Settings className="w-5 h-5 flex-shrink-0" />
              Settings
            </button>
          </div>
        </nav>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        
        {/* Header */}
        <header className="h-16 flex-shrink-0 border-b border-slate-800/80 px-6 flex items-center justify-between bg-slate-900/80 backdrop-blur-sm">
          <h1 className="text-xl font-semibold tracking-tight">System Status</h1>
          
          <div className="flex items-center gap-3">
            {/* Active fault warning badge */}
            {activeFaults && activeFaults.length > 0 && (
              <button
                onClick={() => { setShowSimulator(true); setActiveNav('simulator'); }}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-amber-600/20 border border-amber-500/40 text-amber-300 hover:bg-amber-600/30 transition-colors"
              >
                <AlertTriangle className="w-3.5 h-3.5 animate-pulse" />
                {activeFaults.length} Active Fault{activeFaults.length > 1 ? 's' : ''}
                <Wrench className="w-3 h-3" />
              </button>
            )}

            <button className="relative p-2 text-slate-400 hover:text-slate-200 transition-colors rounded-lg hover:bg-slate-800">
              <Bell className="w-5 h-5" />
              {incidents && incidents.length > 0 && (
                <>
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full animate-ping"></span>
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full"></span>
                </>
              )}
            </button>

            {/* Admin User chip */}
            <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5">
              <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-500 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                AD
              </div>
              <div className="text-left">
                <div className="text-xs font-semibold text-slate-200 leading-none">Admin User</div>
                <div className="text-[10px] text-slate-500 leading-none mt-0.5 uppercase tracking-wide">Karnataka Electricity Board</div>
              </div>
            </div>
          </div>
        </header>

        {/* Content Split: List & Map */}
        <main className="flex-1 flex overflow-hidden">
          {/* Incident List Side Panel */}
          <div className="w-96 flex-shrink-0 overflow-y-auto border-r border-slate-800/80 bg-slate-900/40 p-4 z-10 custom-scrollbar">
            <IncidentList 
              selectedIncidentId={selectedIncidentId} 
              onSelectIncident={setSelectedIncidentId} 
            />
          </div>
          
          {/* Map View Main Area */}
          <div className="flex-1 relative z-0 p-4">
            <MapView 
              incidents={incidents}
              mapData={mapData}
              isLoading={mapLoading}
              selectedIncidentId={selectedIncidentId}
              onSelectIncident={setSelectedIncidentId}
            />
            
            {/* Floating Incident Detail Panel */}
            {selectedIncidentId && (
              <IncidentDetail 
                incidentId={selectedIncidentId}
                incidents={incidents}
                mapData={mapData}
                onClose={() => setSelectedIncidentId(null)}
              />
            )}
          </div>
        </main>
      </div>
      {showSimulator && (
        <SimulatorPanel
          onClose={() => { setShowSimulator(false); setActiveNav('map'); }}
          onInjectionSuccess={handleInjectionSuccess}
        />
      )}
      {showScheduledOutages && (
        <ScheduledOutagesPanel
          onClose={() => { setShowScheduledOutages(false); setActiveNav('map'); }}
          mapData={mapData}
        />
      )}
      {showHistory && (
        <IncidentHistoryPanel
          onClose={() => { setShowHistory(false); setActiveNav('map'); }}
        />
      )}
    </div>
  );
}
