import { useState, useEffect } from 'react';

export function useIncidents(pollingIntervalMs = 3000) {
  const [incidents, setIncidents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    const { signal } = controller;

    async function fetchIncidents() {
      try {
        const res = await fetch('/api/incidents', { signal });
        if (!res.ok) {
          throw new Error(`API returned status: ${res.status}`);
        }
        const data = await res.json();
        
        if (isMounted) {
          setIncidents(data);
          setError(null);
          // setIsLoading(false) is idempotent once already false, so it's safe
          // to call unconditionally without reading `isLoading` in this closure
          setIsLoading(false);
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          // Request was cancelled intentionally, do nothing
          return;
        }
        if (isMounted) {
          console.error("Failed to fetch incidents:", err);
          setError(err.message || 'Failed to connect to backend.');
          setIsLoading(false);
        }
      }
    }

    // Initial fetch
    fetchIncidents();

    // Setup polling
    const intervalId = setInterval(fetchIncidents, pollingIntervalMs);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
      controller.abort();
    };
  }, [pollingIntervalMs]); // Only re-run if polling interval changes

  return { incidents, isLoading, error };
}
