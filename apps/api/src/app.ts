import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { aircraftRoutes } from './routes/aircraft.ts';
import { defectRoutes } from './routes/defects.ts';
import { healthRoutes } from './routes/health.ts';
import { importRoutes } from './routes/imports.ts';
import type { Storage } from './storage.ts';

export interface AppOptions {
  pool: pg.Pool;
  storage: Storage;
  logLevel?: string;
  rateLimitMax?: number;
}

const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/;

export async function buildApp({
  pool,
  storage,
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
  return app;
}
