import { dueDashboardSchema } from '@squawk/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { loadDueItems } from '../due.ts';

export const dashboardRoutes: FastifyPluginAsyncZod<{ pool: pg.Pool }> = async (app, { pool }) => {
  app.get('/dashboard/due', { schema: { response: { 200: dueDashboardSchema } } }, async () => {
    const now = new Date();
    return { computedAt: now.toISOString(), items: await loadDueItems(pool, now) };
  });
};
