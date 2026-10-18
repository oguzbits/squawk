import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type pg from 'pg';

const healthSchema = z.object({
  status: z.enum(['ok', 'error']),
  checks: z.object({ database: z.enum(['ok', 'error']) }),
});

export const healthRoutes: FastifyPluginAsyncZod<{ pool: pg.Pool }> = async (app, { pool }) => {
  app.get(
    '/health',
    {
      config: { rateLimit: false },
      schema: { response: { 200: healthSchema, 503: healthSchema } },
    },
    async (req, reply) => {
      try {
        await pool.query('SELECT 1');
        return { status: 'ok', checks: { database: 'ok' } } as const;
      } catch (err) {
        req.log.error({ err }, 'database health check failed');
        return reply.code(503).send({ status: 'error', checks: { database: 'error' } });
      }
    },
  );
};
