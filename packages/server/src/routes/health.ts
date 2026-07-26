import type {FastifyInstance} from 'fastify';
import {sql} from 'drizzle-orm';
import {db} from '../db/client.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
    } catch (error) {
      app.log.error({error}, 'health check: database unreachable');
      return reply.code(503).send({status: 'degraded', database: 'unreachable'});
    }
    return {status: 'ok', database: 'ok'};
  });
}
