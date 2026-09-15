import { useState, useCallback } from 'react';

const STORAGE_KEY = 'kspdb.preferences.v1';

const DEFAULTS = {
  incidentPollMs: 3000,
  mapPollMs: 5000,
  autoSelectNewIncident: true,
  soundAlerts: false,
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

/**
 * Small localStorage-backed preferences store for per-viewer UI settings
 * (polling cadence, notification behavior). Not shared across devices/users —
 * purely a convenience layer, matching the demo-scale scope of this app.
 */
export function usePreferences() {
  const [preferences, setPreferences] = useState(load);

  const updatePreference = useCallback((key, value) => {
    setPreferences((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Private browsing / storage disabled — preference just won't persist.
      }
      return next;
    });
  }, []);

  const resetPreferences = useCallback(() => {
    setPreferences(DEFAULTS);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  return { preferences, updatePreference, resetPreferences };
}
