import { useState, useEffect } from 'react';

export function useIncidents(pollingIntervalMs = 3000) {
  const [incidents, setIncidents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchIncidents() {
      try {
        const res = await fetch('/api/incidents');
        if (!res.ok) {
          throw new Error(`API returned status: ${res.status}`);
        }
        const data = await res.json();
        
        if (isMounted) {
          setIncidents(data);
          setError(null);
          // Only clear loading state after the first successful fetch
          if (isLoading) setIsLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          console.error("Failed to fetch incidents:", err);
          setError(err.message || 'Failed to connect to backend.');
          if (isLoading) setIsLoading(false);
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
    };
  }, [pollingIntervalMs]); // Only re-run if polling interval changes

  return { incidents, isLoading, error };
}
