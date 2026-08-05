import { prisma as db } from '../db.js';

const VALID_TRANSITIONS = {
  'DETECTED': ['ACKNOWLEDGED', 'VERIFIED'],
  'ACKNOWLEDGED': ['CREW_ASSIGNED', 'VERIFIED'],
  'CREW_ASSIGNED': ['RESOLVED', 'VERIFIED'],
  'RESOLVED': ['VERIFIED'],
  'VERIFIED': ['CLOSED'],
  'CLOSED': []
};

/**
 * Fetch a ticket by ID, optionally including the incident
 */
export async function getTicket(id, includeIncident = false) {
  const ticket = await db.ticket.findUnique({
    where: { id },
    include: includeIncident ? { incident: true } : undefined
  });
  return ticket;
}

/**
 * List tickets based on optional state or incident_id filters
 */
export async function listTickets(filters = {}) {
  const where = {};
  if (filters.state) {
    where.state = filters.state;
  }
  if (filters.incident_id) {
    where.incident_id = filters.incident_id;
  }
  return await db.ticket.findMany({
    where,
    include: { incident: true },
    orderBy: { updated_at: 'desc' }
  });
}

/**
 * Transition a ticket to a new state.
 * Throws an Error if the transition is illegal.
 */
export async function transitionTicket(id, newState, options = { isSystem: false }) {
  const client = options.db || db;
  const ticket = await client.ticket.findUnique({ where: { id } });
  
  if (!ticket) {
    throw new Error(`Ticket with id ${id} not found.`);
  }

  const currentState = ticket.state;
  const allowedNextStates = VALID_TRANSITIONS[currentState] || [];
  
  if (!allowedNextStates.includes(newState)) {
    throw new Error(`Illegal state transition from ${currentState} to ${newState}.`);
  }

  if (newState === 'VERIFIED' && !options.isSystem) {
    throw new Error(`State VERIFIED can only be set by the system (telemetry-based restoration), not via manual operator transition.`);
  }

  const updateData = { state: newState };
  
  // Populate timestamps upon entering specific states
  if (newState === 'RESOLVED') {
    updateData.resolved_at = new Date();
  }
  if (newState === 'VERIFIED') {
    updateData.verified_at = new Date();
  }

  return await client.ticket.update({
    where: { id },
    data: updateData
  });
}
