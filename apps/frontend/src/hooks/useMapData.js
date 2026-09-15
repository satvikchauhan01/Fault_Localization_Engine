import { useState, useEffect, useRef } from 'react';

/**
 * Fetches the static network topology once on mount, then polls only the
 * lightweight /api/map/state endpoint for live PoleState updates.
 *
 * Why: /api/map/data serialises 12,000+ DB rows on every poll interval,
 * causing the backend to steadily exhaust its V8 heap and crash.
 * The split approach reduces the per-poll payload by ~70×.
 *
 * @param {number} [pollingIntervalMs=5000] - How often to poll /state.
 */
export function useMapData(pollingIntervalMs = 5000) {
  const [mapData, setMapData] = useState({
    feeders: [],
    transformers: [],
    poles: [],
    topology_edges: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Store static topology in a ref so the state-polling closure can read it
  // without re-subscribing to a stale dependency.
  const topologyRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    const { signal } = controller;
    let intervalId = null;

    // ── 1. Fetch static topology ONCE ────────────────────────────────────────
    async function fetchTopology() {
      try {
        const res = await fetch('/api/map/topology', { signal });
        if (!res.ok) throw new Error(`Topology API returned status: ${res.status}`);
        const data = await res.json();
        if (!isMounted) return;

        topologyRef.current = data;

        // Merge with any state we may already have (empty on first load)
        setMapData(prev => mergeTopologyAndState(data, prev._stateSnapshot || []));
        setError(null);

        // ── 2. Start polling /state after topology is ready ─────────────────
        intervalId = setInterval(fetchState, pollingIntervalMs);
        // Fetch immediately so UI shows live state without waiting one interval
        fetchState();
      } catch (err) {
        if (err.name === 'AbortError') return;
        if (isMounted) {
          console.error('[useMapData] Failed to fetch topology:', err);
          setError(err.message || 'Failed to connect to backend.');
          setIsLoading(false);
        }
      }
    }

    // ── Lightweight state poll ────────────────────────────────────────────────
    async function fetchState() {
      if (!topologyRef.current) return; // topology not ready yet
      try {
        const res = await fetch('/api/map/state', { signal });
        if (!res.ok) throw new Error(`State API returned status: ${res.status}`);
        const { pole_states } = await res.json();
        if (!isMounted) return;

        setMapData(() => {
          const merged = mergeTopologyAndState(topologyRef.current, pole_states);
          // Stash the latest state snapshot so topology re-merges correctly
          merged._stateSnapshot = pole_states;
          return merged;
        });
        setError(null);
        if (isLoading) setIsLoading(false);
      } catch (err) {
        if (err.name === 'AbortError') return;
        if (isMounted) {
          console.error('[useMapData] Failed to fetch pole states:', err);
          // Don't surface transient poll errors as fatal; keep existing map data
        }
      }
    }

    fetchTopology();

    return () => {
      isMounted = false;
      clearInterval(intervalId);
      controller.abort();
    };
  }, [pollingIntervalMs]); // eslint-disable-line react-hooks/exhaustive-deps

  return { mapData, isLoading, error };
}

/**
 * Merges static topology with a fresh PoleState snapshot.
 * Returns a new mapData object with each pole enriched with its current state.
 *
 * @param {{ feeders, transformers, poles, topology_edges }} topology
 * @param {Array<{ pole_id: string }>} poleStates
 * @returns {object}
 */
function mergeTopologyAndState(topology, poleStates) {
  if (!topology) return { feeders: [], transformers: [], poles: [], topology_edges: [] };

  const stateMap = new Map((poleStates || []).map(s => [s.pole_id, s]));
  const poles = (topology.poles || []).map(p => ({
    ...p,
    state: stateMap.get(p.id) || null,
  }));

  return {
    feeders: topology.feeders || [],
    transformers: topology.transformers || [],
    poles,
    topology_edges: topology.topology_edges || [],
  };
}
