import { completeTaskResponseSchema } from '@squawk/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPool } from '../src/db.ts';
import { loadDueItems } from '../src/due.ts';
import { createS3Client, createStorage } from '../src/storage.ts';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const registration = `M-${Date.now().toString(36).toUpperCase()}`.slice(0, 7);
let app: FastifyInstance;
let aircraftId: string;

beforeAll(async () => {
  app = await buildApp({
    pool,
    storage: createStorage(createS3Client(), config.S3_BUCKET),
    logLevel: 'silent',
  });
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO aircraft (registration, model, msn) VALUES ($1, 'A320-214', '1') RETURNING id",
    [registration],
  );
  aircraftId = rows[0]?.id ?? '';
});

afterAll(async () => {
  await pool.query('DELETE FROM maintenance_task WHERE aircraft_id = $1', [aircraftId]);
  await pool.query('DELETE FROM aircraft WHERE id = $1', [aircraftId]);
  await app.close();
  await pool.end();
});

async function overdueTask() {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO maintenance_task (aircraft_id, name, interval_days, last_done_at)
     VALUES ($1, 'A-check', 30, now() - interval '60 days') RETURNING id`,
    [aircraftId],
  );
  return rows[0]?.id ?? '';
}

const complete = (id: string) =>
  app.inject({ method: 'POST', url: `/maintenance-tasks/${id}/complete` });
const statusOf = async (taskId: string) =>
  (await loadDueItems(pool, new Date())).find((i) => i.taskId === taskId)?.status;

describe('POST /maintenance-tasks/:id/complete', () => {
  it('resets the task so it is no longer overdue', async () => {
    const id = await overdueTask();
    expect(await statusOf(id)).toBe('overdue');
    const res = await complete(id);
    expect(res.statusCode).toBe(200);
    expect(completeTaskResponseSchema.parse(res.json()).taskId).toBe(id);
    expect(await statusOf(id)).toBe('ok');
  });

  it('can be repeated', async () => {
    const id = await overdueTask();
    expect((await complete(id)).statusCode).toBe(200);
    expect((await complete(id)).statusCode).toBe(200);
  });

  it('answers 404 for an unknown task', async () => {
    expect((await complete('6f1c0f50-0000-4000-8000-000000000000')).statusCode).toBe(404);
  });

  it('answers 400 for an invalid id', async () => {
    expect((await complete('nope')).statusCode).toBe(400);
  });
});
