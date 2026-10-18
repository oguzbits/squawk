import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { createPool } from '../src/db.ts';
import { createS3Client, createStorage } from '../src/storage.ts';

// Port 1 refuses connections, so every query fails fast.
const pool = createPool('postgres://squawk:squawk@127.0.0.1:1/squawk');
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({
    pool,
    storage: createStorage(createS3Client(), 'unused'),
    logLevel: 'silent',
  });
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('when the database is unreachable', () => {
  it('reports unhealthy with 503', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error', checks: { database: 'error' } });
  });

  it('answers 500 without leaking internal error details', async () => {
    const res = await app.inject({ method: 'GET', url: '/aircraft' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal Server Error',
    });
  });
});

describe('request id', () => {
  it('echoes a valid incoming x-request-id', async () => {
    const res = await app.inject({ url: '/health', headers: { 'x-request-id': 'abc-123' } });
    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('replaces a malformed x-request-id with a generated UUID', async () => {
    const res = await app.inject({ url: '/health', headers: { 'x-request-id': 'bad id\n' } });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
