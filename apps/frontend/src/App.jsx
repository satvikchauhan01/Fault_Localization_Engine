import React, { useState } from 'react';
import IncidentList from './components/IncidentList';
import MapView from './components/MapView';
import IncidentDetail from './components/IncidentDetail';
import SimulatorPanel from './pages/SimulatorPanel';
import { useIncidents } from './hooks/useIncidents';
import { useMapData } from './hooks/useMapData';
import { Activity, Shield, Map, Settings, Bell, TestTube, Zap } from 'lucide-react';

export default function App() {
  const [selectedIncidentId, setSelectedIncidentId] = useState(null);
  const [showSimulator, setShowSimulator] = useState(false);
  
  // Lift the data fetching up so we can share it with MapView and IncidentDetail
  const { incidents } = useIncidents(3000);
  const { mapData, isLoading: mapLoading } = useMapData(5000);

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
        <div className="fixed bottom-4 right-4 z-[3000] bg-slate-800 border border-slate-700 text-slate-200 px-4 py-3 rounded-lg shadow-2xl animate-in slide-in-from-bottom-4 flex items-start gap-3">
          <Activity className="w-5 h-5 text-blue-400 mt-0.5" />
          <div className="whitespace-pre-line text-sm">{toastMessage}</div>
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside className="w-16 md:w-20 flex-shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col transition-all duration-300 z-50">
        <div className="h-16 flex items-center justify-center border-b border-slate-800">
          <Zap className="w-8 h-8 text-blue-500" />
        </div>
        
        <nav className="flex-1 py-6 flex flex-col gap-6 items-center">
          <a href="#" className="p-3 rounded-xl bg-blue-500/10 text-blue-400 group relative">
            <Map className="w-6 h-6 flex-shrink-0" />
            <div className="absolute left-0 w-1 h-8 bg-blue-500 rounded-r-full -ml-3 top-2"></div>
          </a>
          <a href="#" className="p-3 rounded-xl text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 group transition-colors">
            <Activity className="w-6 h-6 flex-shrink-0" />
          </a>
          <button 
            onClick={() => setShowSimulator(true)}
            className="p-3 rounded-xl text-amber-500 hover:bg-slate-800/50 hover:text-amber-400 group transition-colors"
          >
            <TestTube className="w-6 h-6 flex-shrink-0" />
          </button>
          <a href="#" className="p-3 rounded-xl text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 group transition-colors mt-auto">
            <Settings className="w-6 h-6 flex-shrink-0" />
          </a>
        </nav>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        
        {/* Header */}
        <header className="h-16 flex-shrink-0 glass-panel border-b border-slate-800/80 px-6 flex items-center justify-between sticky top-0 z-40 bg-slate-900/80">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold tracking-tight">System Status</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <button className="relative p-2 text-slate-400 hover:text-slate-200 transition-colors">
              <Bell className="w-5 h-5" />
              {incidents && incidents.length > 0 && (
                <>
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full animate-ping"></span>
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full"></span>
                </>
              )}
            </button>
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-500 shadow-lg border border-slate-700"></div>
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
      {showSimulator && <SimulatorPanel onClose={() => setShowSimulator(false)} onInjectionSuccess={handleInjectionSuccess} />}
    </div>
  );
}
