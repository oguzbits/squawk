import { completeTaskResponseSchema } from '@squawk/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { z } from 'zod';
import { errorSchema, problem } from './errors.ts';

interface MaintenanceOptions {
  pool: pg.Pool;
  /** Called after the change is committed, e.g. to invalidate the dashboard cache. */
  onChange?: () => Promise<void>;
}

export const maintenanceRoutes: FastifyPluginAsyncZod<MaintenanceOptions> = async (
  app,
  { pool, onChange },
) => {
  app.post(
    '/maintenance-tasks/:id/complete',
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        response: { 200: completeTaskResponseSchema, 404: errorSchema },
      },
    },
    async (req, reply) => {
      const { rows } = await pool.query<{ id: string; last_done_at: Date }>(
        'UPDATE maintenance_task SET last_done_at = now() WHERE id = $1 RETURNING id, last_done_at',
        [req.params.id],
      );
      const row = rows[0];
      if (!row) return problem(reply, 404, 'Maintenance task not found');
      await onChange?.();
      return { taskId: row.id, lastDoneAt: row.last_done_at.toISOString() };
    },
  );
};
