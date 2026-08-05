import { useState, useEffect, useCallback } from 'react';

export function useScheduledOutages(pollingIntervalMs = 10000) {
  const [outages, setOutages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchOutages = useCallback(async (signal) => {
    try {
      const res = await fetch('/api/scheduled-outages', { signal });
      if (!res.ok) throw new Error(`API returned status: ${res.status}`);
      const data = await res.json();
      setOutages(data);
      setError(null);
      setIsLoading(false);
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Failed to fetch scheduled outages:', err);
      setError(err.message || 'Failed to connect to backend.');
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchOutages(controller.signal);
    const id = setInterval(() => fetchOutages(controller.signal), pollingIntervalMs);
    return () => {
      clearInterval(id);
      controller.abort();
    };
  }, [fetchOutages, pollingIntervalMs]);

  /**
   * Create a new scheduled outage.
   * @param {{ id: string, scope: 'DT'|'FEEDER'|'SPAN', target_id: string, start: string, end: string, reason: string }} payload
   */
  const createOutage = useCallback(async (payload) => {
    const res = await fetch('/api/scheduled-outages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.message || `Failed to create outage (${res.status})`);
    }
    // Refresh list immediately
    fetchOutages();
    return res.json();
  }, [fetchOutages]);

  return { outages, isLoading, error, createOutage };
}
