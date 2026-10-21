import { dueDashboardSchema, type DueDashboard } from '@squawk/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type pg from 'pg';
import type { DueCache } from '../cache.ts';
import { loadDueItems } from '../due.ts';

export const dashboardRoutes: FastifyPluginAsyncZod<{
  pool: pg.Pool;
  cache?: DueCache | undefined;
}> = async (app, { pool, cache }) => {
  app.get('/dashboard/due', { schema: { response: { 200: dueDashboardSchema } } }, async () => {
    const cached = await cache?.read();
    if (cached?.value) return cached.value;
    const now = new Date();
    const dashboard: DueDashboard = {
      computedAt: now.toISOString(),
      items: await loadDueItems(pool, now),
    };
    await cached?.store(dashboard);
    return dashboard;
  });
};
