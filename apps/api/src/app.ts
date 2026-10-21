import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { createDueCache, type RedisClient } from './cache.ts';
import { aircraftRoutes } from './routes/aircraft.ts';
import { dashboardRoutes } from './routes/dashboard.ts';
import { defectRoutes } from './routes/defects.ts';
import { healthRoutes } from './routes/health.ts';
import { maintenanceRoutes } from './routes/maintenance.ts';
import { importRoutes } from './routes/imports.ts';
import type { Storage } from './storage.ts';

export interface AppOptions {
  pool: pg.Pool;
  storage: Storage;
  redis?: RedisClient;
  /** Key prefix for the dashboard cache; tests use their own to stay apart. */
  cachePrefix?: string;
  logLevel?: string;
  rateLimitMax?: number;
}

const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/;

export async function buildApp({
  pool,
  storage,
  redis,
  cachePrefix,
  logLevel = 'info',
  rateLimitMax = 100,
}: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: logLevel },
    requestIdHeader: false,
    logController: new LogController({ requestIdLogLabel: 'correlationId' }),
    genReqId: (req) => {
      const header = req.headers['x-request-id'];
      return typeof header === 'string' && REQUEST_ID.test(header) ? header : randomUUID();
    },
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  app.setErrorHandler((err: { statusCode?: number }, req, reply) => {
    if (err.statusCode !== undefined && err.statusCode < 500) return reply.send(err);
    req.log.error({ err }, 'request failed');
    return reply
      .code(500)
      .send({ statusCode: 500, error: 'Internal Server Error', message: 'Internal Server Error' });
  });

  pool.on('error', (err) => app.log.error({ err }, 'idle database client error'));

  await app.register(rateLimit, { max: rateLimitMax, timeWindow: '1 minute' });
  await app.register(healthRoutes, { pool });
  await app.register(aircraftRoutes, { pool });
  await app.register(defectRoutes, { pool, storage });
  await app.register(importRoutes, { pool, storage });
  const cache = redis ? createDueCache(redis, app.log, cachePrefix) : undefined;
  await app.register(dashboardRoutes, { pool, cache });
  await app.register(maintenanceRoutes, {
    pool,
    onChange: cache ? () => cache.invalidate() : undefined,
  });
  return app;
}
