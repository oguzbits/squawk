import { randomUUID } from 'node:crypto';
import { dueDashboardSchema } from '@squawk/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPool } from '../src/db.ts';
import { loadDueItems } from '../src/due.ts';
import { createS3Client, createStorage } from '../src/storage.ts';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const suffix = Date.now().toString(36).toUpperCase();
const NOW = new Date('2026-06-01T12:00:00Z');
const LAST_DONE = '2026-01-01T00:00:00Z';
const importId = randomUUID();
const aircraftIds: string[] = [];
let app: FastifyInstance;
let a1: string;
let a2: string;

async function aircraft(tag: string) {
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO aircraft (registration, model, msn) VALUES ($1, 'A320-214', '1') RETURNING id",
    [`D-${tag}${suffix}`.slice(0, 7)],
  );
  const id = rows[0]?.id ?? '';
  aircraftIds.push(id);
  return id;
}

async function task(aircraftId: string, name: string, intervalHours: number, lastDone = LAST_DONE) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO maintenance_task (aircraft_id, name, interval_hours, last_done_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [aircraftId, name, intervalHours, lastDone],
  );
  return rows[0]?.id ?? '';
}

// A flight of the given length in hours that starts at blockOff.
const flight = (aircraftId: string, blockOff: string, hours: number) =>
  pool.query(
    `INSERT INTO flight (aircraft_id, import_id, block_off, block_on, landings, cycles)
     VALUES ($1, $2, $3::timestamptz, $3::timestamptz + make_interval(hours => $4::int), 1, 1)`,
    [aircraftId, importId, blockOff, hours],
  );

const itemsOf = async (aircraftId: string) =>
  (await loadDueItems(pool, NOW)).filter((i) => i.aircraftId === aircraftId);

beforeAll(async () => {
  app = await buildApp({
    pool,
    storage: createStorage(createS3Client(), config.S3_BUCKET),
    logLevel: 'silent',
  });
  await pool.query("INSERT INTO flight_import (id, file_name, size) VALUES ($1, 'f.csv', 1)", [
    importId,
  ]);
  a1 = await aircraft('A');
  a2 = await aircraft('B');
});

afterAll(async () => {
  await pool.query('DELETE FROM flight WHERE import_id = $1', [importId]);
  await pool.query('DELETE FROM flight_import WHERE id = $1', [importId]);
  await pool.query('DELETE FROM maintenance_task WHERE aircraft_id = ANY($1)', [aircraftIds]);
  await pool.query('DELETE FROM aircraft WHERE id = ANY($1)', [aircraftIds]);
  await app.close();
  await pool.end();
});

describe('loadDueItems', () => {
  it('derives the status from flights after the last completion', async () => {
    const taskId = await task(a1, 'usage', 11);
    await flight(a1, '2026-02-01T08:00:00Z', 6);
    await flight(a1, '2026-02-02T08:00:00Z', 4);
    expect(await itemsOf(a1)).toEqual([
      expect.objectContaining({ taskId, status: 'due-soon', governing: 'hours', remaining: 1 }),
    ]);
  });

  it('ignores flights before the last completion and counts one exactly at it', async () => {
    const id = await aircraft('C');
    await task(id, 'boundary', 100);
    await flight(id, '2025-12-31T20:00:00Z', 10);
    await flight(id, LAST_DONE, 3);
    expect(await itemsOf(id)).toEqual([expect.objectContaining({ remaining: 97 })]);
  });

  it('does not count flights of another aircraft', async () => {
    const id = await aircraft('D');
    await task(id, 'isolated', 100);
    await flight(a2, '2026-03-01T08:00:00Z', 50);
    expect(await itemsOf(id)).toEqual([expect.objectContaining({ remaining: 100, status: 'ok' })]);
  });

  it('sorts overdue first, then by smallest relative remaining', async () => {
    const id = await aircraft('E');
    await flight(id, '2026-04-01T08:00:00Z', 10);
    await task(id, 'ok', 100);
    await task(id, 'soon', 11);
    await task(id, 'late', 8); // -25 %
    await task(id, 'later', 5); // -100 %
    expect((await itemsOf(id)).map((i) => i.taskName)).toEqual(['later', 'late', 'soon', 'ok']);
  });
});

describe('GET /dashboard/due', () => {
  it('returns the dashboard with a timestamp', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard/due' });
    expect(res.statusCode).toBe(200);
    const body = dueDashboardSchema.parse(res.json());
    expect(body.items.some((i) => i.aircraftId === a1)).toBe(true);
  });
});
