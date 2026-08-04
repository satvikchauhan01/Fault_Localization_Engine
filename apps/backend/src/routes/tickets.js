import { getTicket, listTickets, transitionTicket } from '../tickets/service.js';

export default async function ticketRoutes(fastify, options) {
  // GET /tickets
  fastify.get('/', async (request, reply) => {
    const filters = {
      state: request.query.state,
      incident_id: request.query.incident_id
    };
    const tickets = await listTickets(filters);
    return tickets;
  });

  // GET /tickets/:id
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params;
    const ticket = await getTicket(id, true);
    if (!ticket) {
      return reply.status(404).send({ error: 'Ticket not found' });
    }
    return ticket;
  });

  // POST /tickets/:id/transition
  fastify.post('/:id/transition', async (request, reply) => {
    const { id } = request.params;
    const { state } = request.body;

    if (!state) {
      return reply.status(400).send({ error: 'State is required' });
    }

    try {
      const ticket = await transitionTicket(id, state);
      return ticket;
    } catch (error) {
      if (error.message.includes('Illegal state transition') || error.message.includes('State VERIFIED can only be set by the system')) {
        return reply.status(400).send({ error: error.message });
      }
      if (error.message.includes('not found')) {
        return reply.status(404).send({ error: error.message });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });
}
