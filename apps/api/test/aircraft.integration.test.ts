import { DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import { aircraftListSchema } from '@squawk/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPool } from '../src/db.ts';
import { createS3Client, createStorage } from '../src/storage.ts';

const { DATABASE_URL } = loadConfig();
const pool = createPool(DATABASE_URL);
const registration = `T-${Date.now().toString(36).toUpperCase()}`;
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({
    pool,
    storage: createStorage(createS3Client(), loadConfig().S3_BUCKET),
    logLevel: 'silent',
  });
});

afterAll(async () => {
  await pool.query('DELETE FROM aircraft WHERE registration = $1', [registration]);
  await app.close();
  await pool.end();
});

describe('against Floci', () => {
  it('serves the database from the Floci RDS instance', async () => {
    const { DBInstances } = await new RDSClient({}).send(
      new DescribeDBInstancesCommand({ DBInstanceIdentifier: 'squawk' }),
    );
    expect(DBInstances?.[0]).toMatchObject({ DBInstanceStatus: 'available', Engine: 'postgres' });
    expect(String(DBInstances?.[0]?.Endpoint?.Port)).toBe(new URL(DATABASE_URL).port);
  });

  it('reports healthy', async () => {
    const res = await app.inject({ url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', checks: { database: 'ok' } });
  });

  it('lists aircraft sorted by registration', async () => {
    await pool.query('INSERT INTO aircraft (registration, model, msn) VALUES ($1, $2, $3)', [
      registration,
      'A320-214',
      '9999',
    ]);

    const res = await app.inject({ url: '/aircraft' });

    expect(res.statusCode).toBe(200);
    const list = aircraftListSchema.parse(res.json());
    expect(list).toContainEqual(
      expect.objectContaining({ registration, model: 'A320-214', msn: '9999' }),
    );
    const registrations = list.map((a) => a.registration);
    expect(registrations).toEqual([...registrations].sort());
  });
});
