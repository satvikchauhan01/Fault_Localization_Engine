import { useState } from 'react';

export function useTicketWorkflow() {
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState(null);

  const transitionTicket = async (ticketId, newState) => {
    setIsTransitioning(true);
    setTransitionError(null);
    
    try {
      const res = await fetch(`/api/tickets/${ticketId}/transition`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ state: newState })
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || `API returned status: ${res.status}`);
      }
      
      setIsTransitioning(false);
      return { success: true, ticket: data };
    } catch (err) {
      console.error("Failed to transition ticket:", err);
      setTransitionError(err.message || 'Failed to connect to backend.');
      setIsTransitioning(false);
      return { success: false, error: err.message };
    }
  };

  const clearError = () => setTransitionError(null);

  return { transitionTicket, isTransitioning, transitionError, clearError };
}
