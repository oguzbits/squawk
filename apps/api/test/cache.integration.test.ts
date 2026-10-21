import { randomUUID } from 'node:crypto';
import type { DueDashboard } from '@squawk/shared';
import type { FastifyInstance } from 'fastify';
import { createClient } from 'redis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createDueCache } from '../src/cache.ts';
import { loadConfig } from '../src/config.ts';
import { createPool } from '../src/db.ts';
import { createS3Client, createStorage } from '../src/storage.ts';

// Needs the ElastiCache cluster from `pnpm env:up`.
const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const redis = createClient({ url: config.REDIS_URL });
const storage = createStorage(createS3Client(), config.S3_BUCKET);
const prefix = `test-${randomUUID()}`;
const value = (marker: string): DueDashboard => ({
  computedAt: `2026-10-21T10:00:0${marker}.000Z`,
  items: [],
});
const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
const cache = createDueCache(redis, log as never, prefix);
const registration = `K-${Date.now().toString(36).toUpperCase()}`.slice(0, 7);
let aircraftId: string;
let taskId: string;

beforeAll(async () => {
  await redis.connect();
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO aircraft (registration, model, msn) VALUES ($1, 'A320-214', '1') RETURNING id",
    [registration],
  );
  aircraftId = rows[0]?.id ?? '';
  const task = await pool.query<{ id: string }>(
    `INSERT INTO maintenance_task (aircraft_id, name, interval_days, last_done_at)
     VALUES ($1, 'cache', 30, now() - interval '60 days') RETURNING id`,
    [aircraftId],
  );
  taskId = task.rows[0]?.id ?? '';
});

afterAll(async () => {
  const keys = await redis.keys(`${prefix}:*`);
  if (keys.length > 0) await redis.del(keys);
  await redis.quit();
  await pool.query('DELETE FROM maintenance_task WHERE aircraft_id = $1', [aircraftId]);
  await pool.query('DELETE FROM aircraft WHERE id = $1', [aircraftId]);
  await pool.end();
});

beforeEach(() => {
  log.warn.mockClear();
});

const currentVersion = async () => Number((await redis.get(`${prefix}:version`)) ?? 0);

describe('DueCache', () => {
  it('misses first, then serves what was stored, with a TTL', async () => {
    const first = await cache.read();
    expect(first.value).toBeNull();
    await first.store(value('1'));
    expect((await cache.read()).value).toEqual(value('1'));
    const ttl = await redis.ttl(`${prefix}:v0`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(300);
  });

  it.each(['not json'])(
    'treats the unparsable cached value %s as a miss, logs it and recovers',
    async (corrupt) => {
      await redis.set(`${prefix}:v${await currentVersion()}`, corrupt);
      const afterCorrupt = await cache.read();
      expect(afterCorrupt.value).toBeNull();
      expect(log.warn).toHaveBeenCalled();
      await afterCorrupt.store(value('3'));
      expect((await cache.read()).value).toEqual(value('3'));
    },
  );

  it('misses after an invalidation', async () => {
    const reader = await cache.read();
    await reader.store(value('2'));
    await cache.invalidate();
    expect((await cache.read()).value).toBeNull();
  });

  it('never serves a value stored by a reader that started before an invalidation', async () => {
    const slowReader = await cache.read();
    await cache.invalidate();
    await slowReader.store(value('3'));
    expect((await cache.read()).value).toBeNull();
  });

  it.each([
    ['unparseable', '{not json'],
    ['valid JSON of the wrong shape', '{"items":"nope"}'],
  ])('treats a cached value that is %s as a miss and logs it', async (_name, raw) => {
    const version = Number((await redis.get(`${prefix}:version`)) ?? 0);
    await redis.set(`${prefix}:v${version}`, raw);
    expect((await cache.read()).value).toBeNull();
    expect(log.warn).toHaveBeenCalled();
  });
});

describe('dashboard route with cache', () => {
  let app: FastifyInstance;
  let queries = 0;

  beforeAll(async () => {
    app = await buildApp({
      pool,
      storage,
      logLevel: 'silent',
      redis,
      cachePrefix: `${prefix}-route`,
    });
    pool.on('acquire', () => queries++);
  });
  afterAll(() => app.close());
  const get = () => app.inject({ method: 'GET', url: '/dashboard/due' });
  const statusOfTask = async () =>
    (await get()).json<DueDashboard>().items.find((i) => i.taskId === taskId)?.status;

  it('serves the second request without querying the database', async () => {
    await get();
    const queriesAfterMiss = queries;
    expect(queriesAfterMiss).toBeGreaterThan(0);
    await get();
    expect(queries).toBe(queriesAfterMiss);
  });

  it('shows the new status after a task was completed', async () => {
    expect(await statusOfTask()).toBe('overdue');
    expect(
      (await app.inject({ method: 'POST', url: `/maintenance-tasks/${taskId}/complete` }))
        .statusCode,
    ).toBe(200);
    expect(await statusOfTask()).toBe('ok');
  });
});

describe('Redis unavailable', () => {
  const broken = () => {
    const client = createClient({
      url: 'redis://127.0.0.1:1',
      disableOfflineQueue: true,
      socket: { reconnectStrategy: false },
    });
    client.on('error', () => {});
    return client;
  };

  it('reads as a miss and logs a warning', async () => {
    expect((await createDueCache(broken(), log as never, prefix).read()).value).toBeNull();
    expect(log.warn).toHaveBeenCalled();
  });

  it('answers the dashboard from the database', async () => {
    const app = await buildApp({ pool, storage, logLevel: 'silent', redis: broken() });
    expect((await app.inject({ method: 'GET', url: '/dashboard/due' })).statusCode).toBe(200);
    await app.close();
  });
});
