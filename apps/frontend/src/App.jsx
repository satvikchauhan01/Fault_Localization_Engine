import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import IncidentList from './components/IncidentList';
import MapView from './components/MapView';
import IncidentDetail from './components/IncidentDetail';
import AssetInspector from './components/AssetInspector';
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
import { buildNetworkIndex, locateFault } from './utils/networkModel';
import { resolveActiveOutagePoles } from './utils/scheduledOutageOverlay';
import { AlertTriangle, Map, Settings, TestTube, Zap, Calendar, Wrench, History, Menu, X as CloseIcon, List as ListIcon, PanelRight, Crosshair } from 'lucide-react';

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
    // Audio unavailable (autoplay policy): the visual notification still shows.
  }
}

const NAV_ITEMS = [
  { id: 'map', label: 'Network map', icon: Map },
  { id: 'simulator', label: 'Fault simulator', icon: TestTube },
  { id: 'outages', label: 'Scheduled outages', icon: Calendar },
  { id: 'history', label: 'Incident history', icon: History },
];

export default function App() {
  const [selection, setSelection] = useState(null); // { kind: 'incident'|'pole'|'dt'|'feeder', id, nonce? }
  const [panel, setPanel] = useState(null); // 'simulator' | 'outages' | 'history' | 'settings'
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState('list'); // 'list' | 'map' | 'details', below the lg breakpoint only
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const { preferences, updatePreference, resetPreferences } = usePreferences();
  const { incidents, isLoading: incidentsLoading, error: incidentsError } = useIncidents(preferences.incidentPollMs);
  const { mapData, isLoading: mapLoading } = useMapData(preferences.mapPollMs);
  const { faults: activeFaults } = useSimulator(5000);
  const { outages, isLoading: outagesLoading, error: outagesError, createOutage } = useScheduledOutages(15000);

  const index = useMemo(() => buildNetworkIndex(mapData), [mapData]);
  const outagePoleMap = useMemo(
    () => resolveActiveOutagePoles(outages, mapData.poles, mapData.topology_edges),
    [outages, mapData.poles, mapData.topology_edges]
  );

  const select = useCallback((next) => {
    setSelection(next);
    if (next) setMobileTab('details');
  }, []);

  const locate = useCallback((next) => {
    setSelection({ ...next, nonce: Date.now() });
    setMobileTab('map');
  }, []);

  const showToast = useCallback((message, action) => {
    clearTimeout(toastTimer.current);
    setToast({ message, action });
    toastTimer.current = setTimeout(() => setToast(null), 7000);
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setSelection(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Announce newly detected faults. Opens the newest one unless the operator is
  // already looking at something, in which case it only offers to locate it.
  const seenIncidentIds = useRef(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useEffect(() => {
    if (incidentsLoading) return;
    const ids = new Set(incidents.map((i) => i.id));
    if (seenIncidentIds.current === null) {
      seenIncidentIds.current = ids;
      return;
    }
    const fresh = incidents.filter((i) => !seenIncidentIds.current.has(i.id));
    seenIncidentIds.current = ids;
    if (fresh.length === 0) return;

    const newest = fresh.reduce((a, b) => (new Date(a.first_detected_at) > new Date(b.first_detected_at) ? a : b));
    const where = locateFault(newest, index)?.title;
    if (preferences.soundAlerts) playChime();
    if (preferences.autoSelectNewIncident && !selectionRef.current) {
      locate({ kind: 'incident', id: newest.id });
      showToast(`New ${newest.type} fault detected${where ? `: ${where}` : ''}.`);
    } else {
      showToast(`New ${newest.type} fault detected${where ? `: ${where}` : ''}.`, {
        label: 'Locate',
        onClick: () => locate({ kind: 'incident', id: newest.id }),
      });
    }
  }, [incidents, incidentsLoading, index, preferences.soundAlerts, preferences.autoSelectNewIncident, locate, showToast]);

  const openPanel = (id) => {
    setPanel(id === 'map' ? null : id);
    setMobileSidebarOpen(false);
  };
  const activeNav = panel === 'settings' ? null : panel || 'map';

  const selectedIncident = selection?.kind === 'incident' ? incidents.find((i) => i.id === selection.id) : null;

  return (
    <div className="flex h-screen w-full bg-slate-950 overflow-hidden text-slate-200">
      {toast && (
        <div className="fixed bottom-4 right-4 z-[3000] max-w-sm bg-slate-900 border border-slate-700 text-slate-200 pl-4 pr-2 py-3 rounded-md shadow-2xl flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <div className="text-sm flex-1">{toast.message}</div>
          {toast.action && (
            <button
              onClick={() => { toast.action.onClick(); setToast(null); }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white"
            >
              <Crosshair className="w-3.5 h-3.5" /> {toast.action.label}
            </button>
          )}
          <button onClick={() => setToast(null)} className="p-1 text-slate-500 hover:text-slate-200" aria-label="Dismiss">
            <CloseIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {mobileSidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={() => setMobileSidebarOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-60 bg-slate-900 border-r border-slate-800 flex flex-col transform transition-transform duration-200 ease-in-out
          ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:relative lg:translate-x-0 lg:w-52 lg:flex-shrink-0`}
      >
        <div className="h-14 flex items-center gap-2.5 px-4 border-b border-slate-800 flex-shrink-0">
          <div className="w-7 h-7 rounded-md bg-blue-600 flex items-center justify-center flex-shrink-0">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div className="leading-tight">
            <div className="font-semibold text-sm text-white">KSPDB</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Fault localization</div>
          </div>
          <button onClick={() => setMobileSidebarOpen(false)} className="ml-auto p-1 text-slate-500 hover:text-slate-200 lg:hidden" aria-label="Close menu">
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 py-3 flex flex-col gap-0.5 px-2 overflow-y-auto custom-scrollbar">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => openPanel(id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                activeNav === id ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </button>
          ))}
          <div className="mt-auto pt-3 border-t border-slate-800">
            <button
              onClick={() => { setPanel('settings'); setMobileSidebarOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                panel === 'settings' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <Settings className="w-4 h-4 flex-shrink-0" />
              Settings
            </button>
          </div>
        </nav>
      </aside>

      <div className="flex-1 flex flex-col h-full min-w-0">
        <header className="h-14 flex-shrink-0 border-b border-slate-800 px-3 sm:px-5 flex items-center justify-between bg-slate-900 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="p-2 -ml-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-md lg:hidden flex-shrink-0"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-base font-semibold truncate">{panel === 'history' ? 'Incident history' : 'Network operations'}</h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {activeFaults && activeFaults.length > 0 && (
              <button
                onClick={() => openPanel('simulator')}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-amber-950/60 border border-amber-800 text-amber-300 hover:bg-amber-900/60"
              >
                <Wrench className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{activeFaults.length} simulated fault{activeFaults.length > 1 ? 's' : ''} active</span>
                <span className="sm:hidden">{activeFaults.length}</span>
              </button>
            )}
            <NotificationBell incidents={incidents} onSelectIncident={(id) => locate({ kind: 'incident', id })} />
            <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-md px-2 sm:px-2.5 py-1">
              <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">AD</div>
              <div className="text-left hidden sm:block leading-tight">
                <div className="text-xs font-medium text-slate-200">Admin User</div>
                <div className="text-[10px] text-slate-500">Control room</div>
              </div>
            </div>
          </div>
        </header>

        {panel === 'history' ? (
          <IncidentHistoryPanel
            index={index}
            onShowOnMap={(next) => { setPanel(null); locate(next); }}
          />
        ) : (
          <>
            <NetworkStatsBar incidents={incidents} mapData={mapData} outages={outages} isLoading={incidentsLoading || mapLoading} />

            <div className="flex-shrink-0 flex lg:hidden border-b border-slate-800 bg-slate-900">
              {[
                { id: 'list', label: 'Incidents', icon: ListIcon },
                { id: 'map', label: 'Map', icon: Map },
                { id: 'details', label: 'Details', icon: PanelRight, disabled: !selection },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setMobileTab(t.id)}
                  disabled={t.disabled}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm border-b-2 transition-colors disabled:opacity-40 ${
                    mobileTab === t.id ? 'border-blue-500 text-blue-300' : 'border-transparent text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <t.icon className="w-4 h-4" />
                  {t.label}
                </button>
              ))}
            </div>

            <main className="flex-1 flex min-h-0">
              <div className={`${mobileTab === 'list' ? 'flex' : 'hidden'} lg:flex w-full lg:w-80 flex-shrink-0 flex-col border-r border-slate-800 bg-slate-950`}>
                <IncidentList
                  incidents={incidents}
                  index={index}
                  isLoading={incidentsLoading}
                  error={incidentsError}
                  selectedIncidentId={selectedIncident?.id}
                  onSelectIncident={(id) => select({ kind: 'incident', id })}
                />
              </div>

              <div className={`${mobileTab === 'map' ? 'block' : 'hidden'} lg:block flex-1 min-w-0 p-2`}>
                <MapView
                  mapData={mapData}
                  index={index}
                  incidents={incidents}
                  outages={outages}
                  isLoading={mapLoading}
                  selection={selection}
                  onSelect={(next) => (next ? select(next) : setSelection(null))}
                />
              </div>

              {selection && (
                <div className={`${mobileTab === 'details' ? 'flex' : 'hidden'} lg:flex w-full lg:w-[380px] flex-shrink-0 flex-col border-l border-slate-800 bg-slate-950`}>
                  {selection.kind === 'incident' ? (
                    selectedIncident ? (
                      <IncidentDetail
                        incident={selectedIncident}
                        index={index}
                        onClose={() => setSelection(null)}
                        onLocate={() => locate({ kind: 'incident', id: selectedIncident.id })}
                        onSelect={select}
                      />
                    ) : (
                      <div className="p-6 text-center">
                        <p className="text-sm text-slate-300">This incident is no longer active.</p>
                        <p className="text-xs text-slate-500 mt-1">Verified incidents move to Incident history.</p>
                        <div className="mt-4 flex justify-center gap-2">
                          <button onClick={() => openPanel('history')} className="px-3 py-1.5 rounded-md text-sm bg-slate-800 hover:bg-slate-700">Open history</button>
                          <button onClick={() => setSelection(null)} className="px-3 py-1.5 rounded-md text-sm text-slate-400 hover:text-slate-200">Close</button>
                        </div>
                      </div>
                    )
                  ) : (
                    <AssetInspector
                      selection={selection}
                      index={index}
                      incidents={incidents}
                      outagePoleMap={outagePoleMap}
                      onSelect={select}
                      onClose={() => setSelection(null)}
                    />
                  )}
                </div>
              )}
            </main>
          </>
        )}
      </div>

      {panel === 'simulator' && (
        <SimulatorPanel
          onClose={() => setPanel(null)}
          onInjectionSuccess={() => {
            setPanel(null);
            setSelection(null);
            showToast('Fault injected. Poles turn amber now and are confirmed dark after the 90 s debounce.');
          }}
        />
      )}
      {panel === 'outages' && (
        <ScheduledOutagesPanel
          onClose={() => setPanel(null)}
          mapData={mapData}
          outages={outages}
          isLoading={outagesLoading}
          error={outagesError}
          createOutage={createOutage}
        />
      )}
      {panel === 'settings' && (
        <SettingsPanel
          onClose={() => setPanel(null)}
          preferences={preferences}
          updatePreference={updatePreference}
          resetPreferences={resetPreferences}
        />
      )}
    </div>
  );
}
