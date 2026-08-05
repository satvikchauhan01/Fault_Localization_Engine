import { useState, useEffect } from 'react';

export function useMapData(pollingIntervalMs = 5000) {
  const [mapData, setMapData] = useState({
    feeders: [],
    transformers: [],
    poles: [],
    topology_edges: []
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    const { signal } = controller;

    async function fetchMapData() {
      try {
        const res = await fetch('/api/map/data', { signal });
        if (!res.ok) {
          throw new Error(`API returned status: ${res.status}`);
        }
        const data = await res.json();
        
        if (isMounted) {
          setMapData(data);
          setError(null);
          if (isLoading) setIsLoading(false);
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        if (isMounted) {
          console.error("Failed to fetch map data:", err);
          setError(err.message || 'Failed to connect to backend.');
          if (isLoading) setIsLoading(false);
        }
      }
    }

    // Initial fetch
    fetchMapData();

    // Setup polling for live state updates
    const intervalId = setInterval(fetchMapData, pollingIntervalMs);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
      controller.abort();
    };
  }, [pollingIntervalMs]);

  return { mapData, isLoading, error };
}
