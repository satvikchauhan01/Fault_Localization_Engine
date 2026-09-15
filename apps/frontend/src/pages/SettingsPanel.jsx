import React from 'react';
import { X, Settings as SettingsIcon, Gauge, Bell, RotateCcw, Info } from 'lucide-react';

const POLL_OPTIONS = [
  { value: 2000, label: 'Fast (2s)' },
  { value: 3000, label: 'Normal (3s)' },
  { value: 5000, label: 'Relaxed (5s)' },
  { value: 10000, label: 'Slow (10s)' },
];

const MAP_POLL_OPTIONS = [
  { value: 3000, label: 'Fast (3s)' },
  { value: 5000, label: 'Normal (5s)' },
  { value: 10000, label: 'Relaxed (10s)' },
  { value: 15000, label: 'Slow (15s)' },
];

function Toggle({ checked, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
        checked ? 'bg-blue-500' : 'bg-slate-700'
      }`}
    >
      <span
        className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

export default function SettingsPanel({ onClose, preferences, updatePreference, resetPreferences }) {
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
            <div className="p-2 bg-slate-500/15 rounded-lg">
              <SettingsIcon className="w-5 h-5 text-slate-300" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-200">Settings</h2>
              <p className="text-xs text-slate-500">Per-device display preferences</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-slate-300 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6">
          {/* Polling Cadence */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2 mb-3">
              <Gauge className="w-3.5 h-3.5" /> Live Update Cadence
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-slate-300 block mb-1.5">Incident List</label>
                <select
                  value={preferences.incidentPollMs}
                  onChange={(e) => updatePreference('incidentPollMs', Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                  {POLL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-300 block mb-1.5">Network Map</label>
                <select
                  value={preferences.mapPollMs}
                  onChange={(e) => updatePreference('mapPollMs', Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                  {MAP_POLL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Faster cadence shows new faults sooner but polls the backend more often. Applies immediately.
              </p>
            </div>
          </section>

          {/* Notifications */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2 mb-3">
              <Bell className="w-3.5 h-3.5" /> Notifications
            </h3>
            <div className="space-y-3">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="text-sm text-slate-300">Auto-open new incidents</div>
                  <div className="text-xs text-slate-600">Jump to the detail panel when a fault you just injected produces an incident.</div>
                </div>
                <Toggle
                  checked={preferences.autoSelectNewIncident}
                  onChange={(v) => updatePreference('autoSelectNewIncident', v)}
                />
              </label>
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="text-sm text-slate-300">Sound alert on new incident</div>
                  <div className="text-xs text-slate-600">Play a short chime when a new active incident is detected.</div>
                </div>
                <Toggle
                  checked={preferences.soundAlerts}
                  onChange={(v) => updatePreference('soundAlerts', v)}
                />
              </label>
            </div>
          </section>

          {/* About */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2 mb-3">
              <Info className="w-3.5 h-3.5" /> About
            </h3>
            <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3 text-xs text-slate-500 space-y-1">
              <div className="flex justify-between"><span>Engine</span><span className="text-slate-300">KSPDB Fault Localization</span></div>
              <div className="flex justify-between"><span>Live view</span><span className="text-slate-300">Polling (no WebSocket)</span></div>
            </div>
          </section>

          <button
            onClick={resetPreferences}
            className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset to defaults
          </button>
        </div>
      </div>
    </div>
  );
}
