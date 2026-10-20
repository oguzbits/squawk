import { createImportResponseSchema, flightImportSchema } from '@squawk/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPool } from '../src/db.ts';
import { createS3Client, createStorage } from '../src/storage.ts';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const storage = createStorage(createS3Client(), config.S3_BUCKET);
const createdIds: string[] = [];
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ pool, storage, logLevel: 'silent' });
});

afterAll(async () => {
  await pool.query('DELETE FROM flight_import WHERE id = ANY($1)', [createdIds]);
  await app.close();
  await pool.end();
});

const create = (payload: object) => app.inject({ method: 'POST', url: '/imports', payload });

describe('POST /imports', () => {
  it('creates a pending import and returns an upload bound to imports/<id>.csv', async () => {
    const res = await create({ fileName: 'flights.csv', size: 1234 });
    expect(res.statusCode).toBe(201);
    const body = createImportResponseSchema.parse(res.json());
    createdIds.push(body.import.id);
    expect(body.import).toMatchObject({ status: 'pending', imported: 0, completedAt: null });
    expect(body.upload.fields['key']).toBe(`imports/${body.import.id}.csv`);
    expect(body.upload.fields['Content-Type']).toBe('text/csv');
  });

  it.each([
    ['empty file', { fileName: 'a.csv', size: 0 }],
    ['file over 5 MB', { fileName: 'a.csv', size: 5 * 1024 * 1024 + 1 }],
    ['missing name', { size: 10 }],
  ])('rejects %s', async (_name, payload) => {
    expect((await create(payload)).statusCode).toBe(400);
  });
});

describe('GET /imports/:id', () => {
  it('returns the import', async () => {
    const created = createImportResponseSchema.parse(
      (await create({ fileName: 'flights.csv', size: 10 })).json(),
    );
    createdIds.push(created.import.id);
    const res = await app.inject({ method: 'GET', url: `/imports/${created.import.id}` });
    expect(flightImportSchema.parse(res.json()).fileName).toBe('flights.csv');
  });

  it('answers 404 for an unknown import', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/imports/6f1c0f50-0000-4000-8000-000000000000',
    });
    expect(res.statusCode).toBe(404);
  });
});
