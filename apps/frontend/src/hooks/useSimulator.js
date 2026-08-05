import { useState, useEffect, useCallback } from 'react';

const API_BASE = '/api/simulator';

export function useSimulator(pollingIntervalMs = 5000) {
  const [faults, setFaults] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchFaults = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/faults`);
      if (!response.ok) throw new Error('Failed to fetch faults');
      const data = await response.json();
      setFaults(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFaults();
    const interval = setInterval(fetchFaults, pollingIntervalMs);
    return () => clearInterval(interval);
  }, [fetchFaults, pollingIntervalMs]);

  const injectFault = async (payload) => {
    const response = await fetch(`${API_BASE}/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to inject fault');
    }
    
    await fetchFaults();
    return data;
  };

  const repairFault = async (faultId) => {
    const response = await fetch(`${API_BASE}/repair/${faultId}`, {
      method: 'POST'
    });
    
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to repair fault');
    }
    
    await fetchFaults();
    return data;
  };

  return {
    faults,
    isLoading,
    error,
    injectFault,
    repairFault,
    refresh: fetchFaults
  };
}
