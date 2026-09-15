import React, { useState } from 'react';
import IncidentList from './components/IncidentList';
import MapView from './components/MapView';
import IncidentDetail from './components/IncidentDetail';
import NetworkStatsBar from './components/NetworkStatsBar';
import NotificationBell from './components/NotificationBell';
import SimulatorPanel from './pages/SimulatorPanel';
import ScheduledOutagesPanel from './pages/ScheduledOutagesPanel';
import IncidentHistoryPanel from './pages/IncidentHistoryPanel';
import SettingsPanel from './pages/SettingsPanel';
import { useIncidents } from './hooks/useIncidents';
import { useMapData } from './hooks/useMapData';
import { useSimulator } from './hooks/useSimulator';
import { useScheduledOutages } from './hooks/useScheduledOutages';
import { usePreferences } from './hooks/usePreferences';
import { Activity, Map, Settings, TestTube, Zap, Calendar, AlertTriangle, Wrench, History, Menu, X as CloseIcon, List as ListIcon } from 'lucide-react';

function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    // Audio unavailable (e.g. autoplay policy) — non-fatal, notification still shows visually.
  }
}

export default function App() {
  const [selectedIncidentId, setSelectedIncidentId] = useState(null);
  const [showSimulator, setShowSimulator] = useState(false);
  const [showScheduledOutages, setShowScheduledOutages] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeNav, setActiveNav] = useState('map');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState('list'); // 'list' | 'map' — only relevant below the lg breakpoint

  const { preferences, updatePreference, resetPreferences } = usePreferences();

  // Lift the data fetching up so we can share it with MapView, IncidentList and IncidentDetail
  const { incidents, isLoading: incidentsLoading, error: incidentsError } = useIncidents(preferences.incidentPollMs);
  const { mapData, isLoading: mapLoading } = useMapData(preferences.mapPollMs);
  // Always poll for active simulator faults — surface a banner if any are unrepaired
  const { faults: activeFaults } = useSimulator(5000);
  // Lifted here too — ScheduledOutagesPanel and its create form used to each
  // poll this independently; MapView/NetworkStatsBar also need it now to
  // show which poles are under an active planned outage.
  const { outages, isLoading: outagesLoading, error: outagesError, createOutage } = useScheduledOutages(15000);

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
      if (incidents.length > prevIncidentCountRef.current) {
        if (preferences.soundAlerts) playChime();
        if (waitingForNewIncident && preferences.autoSelectNewIncident) {
          // We have a new incident! Since backend sorts by newest first, incidents[0] is the new one.
          setSelectedIncidentId(incidents[0].id);
          setWaitingForNewIncident(false);
        }
      }
      prevIncidentCountRef.current = incidents.length;
    }
  }, [incidents, waitingForNewIncident, preferences.soundAlerts, preferences.autoSelectNewIncident]);

  return (
    <div className="flex h-screen w-full bg-slate-950 overflow-hidden text-slate-200">
      {/* App-level Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-4 right-4 z-[3000] bg-slate-800 border border-slate-700 text-slate-200 px-4 py-3 rounded-lg shadow-2xl flex items-start gap-3">
          <Activity className="w-5 h-5 text-blue-400 mt-0.5" />
          <div className="whitespace-pre-line text-sm">{toastMessage}</div>
        </div>
      )}

      {/* Mobile sidebar backdrop */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 border-r border-slate-800 flex flex-col transform transition-transform duration-200 ease-in-out
          ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:relative lg:translate-x-0 lg:w-52 lg:flex-shrink-0`}
      >
        {/* Brand */}
        <div className="h-16 flex items-center gap-3 px-5 border-b border-slate-800 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center flex-shrink-0">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-base text-white tracking-tight">KSPDB Engine</span>
          <button
            onClick={() => setMobileSidebarOpen(false)}
            className="ml-auto p-1 text-slate-500 hover:text-slate-200 lg:hidden"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 py-4 flex flex-col gap-1 px-3 overflow-y-auto custom-scrollbar">
          <button
            onClick={() => { setActiveNav('map'); setShowSimulator(false); setShowScheduledOutages(false); setMobileSidebarOpen(false); }}
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
            onClick={() => { setShowSimulator(true); setShowScheduledOutages(false); setActiveNav('simulator'); setMobileSidebarOpen(false); }}
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
            onClick={() => { setShowScheduledOutages(true); setShowSimulator(false); setActiveNav('outages'); setMobileSidebarOpen(false); }}
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
            onClick={() => { setShowHistory(true); setShowSimulator(false); setShowScheduledOutages(false); setActiveNav('history'); setMobileSidebarOpen(false); }}
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
            <button
              onClick={() => { setShowSettings(true); setMobileSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                showSettings
                  ? 'bg-slate-800 text-slate-200'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <Settings className="w-5 h-5 flex-shrink-0" />
              Settings
            </button>
          </div>
        </nav>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        
        {/* Header */}
        <header className="h-16 flex-shrink-0 border-b border-slate-800/80 px-3 sm:px-6 flex items-center justify-between bg-slate-900/80 backdrop-blur-sm gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="p-2 -ml-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors lg:hidden flex-shrink-0"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-lg sm:text-xl font-semibold tracking-tight truncate">System Status</h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {/* Active fault warning badge */}
            {activeFaults && activeFaults.length > 0 && (
              <button
                onClick={() => { setShowSimulator(true); setActiveNav('simulator'); }}
                className="flex items-center gap-1.5 text-xs px-2.5 sm:px-3 py-1.5 rounded-full bg-amber-600/20 border border-amber-500/40 text-amber-300 hover:bg-amber-600/30 transition-colors"
              >
                <AlertTriangle className="w-3.5 h-3.5 animate-pulse" />
                <span className="hidden sm:inline">{activeFaults.length} Active Fault{activeFaults.length > 1 ? 's' : ''}</span>
                <span className="sm:hidden">{activeFaults.length}</span>
                <Wrench className="w-3 h-3 hidden sm:block" />
              </button>
            )}

            <NotificationBell incidents={incidents} onSelectIncident={setSelectedIncidentId} />

            {/* Admin User chip */}
            <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-2 sm:px-3 py-1.5">
              <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-500 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                AD
              </div>
              <div className="text-left hidden sm:block">
                <div className="text-xs font-semibold text-slate-200 leading-none">Admin User</div>
                <div className="text-[10px] text-slate-500 leading-none mt-0.5 uppercase tracking-wide">Karnataka Electricity Board</div>
              </div>
            </div>
          </div>
        </header>

        {/* Live KPI Strip */}
        <NetworkStatsBar incidents={incidents} mapData={mapData} outages={outages} isLoading={incidentsLoading || mapLoading} />

        {/* Mobile List/Map switch — only meaningful below the lg breakpoint */}
        <div className="flex-shrink-0 flex lg:hidden border-b border-slate-800/80 bg-slate-900/60">
          {[
            { id: 'list', label: 'Incident List', icon: ListIcon },
            { id: 'map', label: 'Network Map', icon: Map },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setMobileTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                mobileTab === t.id
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Content Split: List & Map */}
        <main className="flex-1 flex overflow-hidden">
          {/* Incident List Side Panel */}
          <div className={`${mobileTab === 'list' ? 'block' : 'hidden'} lg:block w-full lg:w-96 flex-shrink-0 overflow-y-auto border-r border-slate-800/80 bg-slate-900/40 p-4 z-10 custom-scrollbar`}>
            <IncidentList
              incidents={incidents}
              isLoading={incidentsLoading}
              error={incidentsError}
              selectedIncidentId={selectedIncidentId}
              onSelectIncident={(id) => { setSelectedIncidentId(id); setMobileTab('map'); }}
            />
          </div>

          {/* Map View Main Area */}
          <div className={`${mobileTab === 'map' ? 'block' : 'hidden'} lg:block flex-1 relative z-0 p-2 sm:p-4`}>
            <MapView
              incidents={incidents}
              mapData={mapData}
              outages={outages}
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
          outages={outages}
          isLoading={outagesLoading}
          error={outagesError}
          createOutage={createOutage}
        />
      )}
      {showHistory && (
        <IncidentHistoryPanel
          onClose={() => { setShowHistory(false); setActiveNav('map'); }}
        />
      )}
      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          preferences={preferences}
          updatePreference={updatePreference}
          resetPreferences={resetPreferences}
        />
      )}
    </div>
  );
}
