import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processImport } from './process.ts';

const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });
const registration = `I-${Date.now().toString(36).toUpperCase()}`.slice(0, 7);
const HEADER = 'registration,flight_date,block_off,block_on,landings,cycles';
const row = (reg: string, day: string, from = '08:00', to = '09:00') =>
  `${reg},${day},${day}T${from}:00Z,${day}T${to}:00Z,1,1`;
const importIds: string[] = [];
let aircraftId: string;

beforeAll(async () => {
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO aircraft (registration, model, msn) VALUES ($1, 'A320-214', '1') RETURNING id",
    [registration],
  );
  aircraftId = rows[0]?.id ?? '';
});

afterAll(async () => {
  await pool.query('DELETE FROM flight WHERE aircraft_id = $1', [aircraftId]);
  await pool.query('DELETE FROM flight_import WHERE id = ANY($1)', [importIds]);
  await pool.query('DELETE FROM aircraft WHERE id = $1', [aircraftId]);
  await pool.end();
});

async function run(csv: string | Error, id?: string) {
  const importId = id ?? randomUUID();
  if (!id) {
    await pool.query("INSERT INTO flight_import (id, file_name, size) VALUES ($1, 'f.csv', 1)", [
      importId,
    ]);
    importIds.push(importId);
  }
  const outcome = await processImport(
    { pool, readObject: async () => (csv instanceof Error ? Promise.reject(csv) : csv) },
    importId,
  );
  const { rows } = await pool.query('SELECT * FROM flight_import WHERE id = $1', [importId]);
  return { importId, outcome, record: rows[0] };
}

describe('processImport', () => {
  it('imports valid rows and records rejected lines without row content', async () => {
    const csv = [
      HEADER,
      row(registration, '2026-10-01'),
      row('Z-ZZZZZ', '2026-10-01'),
      'broken',
    ].join('\n');
    const { outcome, record } = await run(csv);
    expect(outcome).toBe('completed');
    expect(record).toMatchObject({ status: 'completed', imported: 1, skipped: 0, rejected: 2 });
    expect(record.rejections).toEqual([
      { line: 3, reason: 'unknown registration' },
      { line: 4, reason: 'expected 6 fields' },
    ]);
  });

  it('skips flights that already exist, also within one file', async () => {
    const day = row(registration, '2026-10-02');
    const first = await run([HEADER, day, day].join('\n'));
    expect(first.record).toMatchObject({ imported: 1, skipped: 1 });
    const second = await run(
      [HEADER, day, row(registration, '2026-10-02', '12:00', '13:00')].join('\n'),
    );
    expect(second.record).toMatchObject({ imported: 1, skipped: 1 });
    const { rows } = await pool.query(
      'SELECT 1 FROM flight WHERE aircraft_id = $1 AND block_off::date = $2',
      [aircraftId, '2026-10-02'],
    );
    expect(rows).toHaveLength(2);
  });

  it('does not process an import twice', async () => {
    const csv = [HEADER, row(registration, '2026-10-03')].join('\n');
    const first = await run(csv);
    const again = await run(csv, first.importId);
    expect(again.outcome).toBe('already-processed');
    const { rows } = await pool.query('SELECT 1 FROM flight WHERE import_id = $1', [
      first.importId,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('marks a file with a wrong header as failed', async () => {
    const { outcome, record } = await run('foo,bar\n1,2');
    expect(outcome).toBe('failed');
    expect(record.status).toBe('failed');
  });

  it('propagates a failed read and leaves the import pending, so the queue retries', async () => {
    await expect(run(new Error('S3 unavailable'))).rejects.toThrow('S3 unavailable');
    const { rows } = await pool.query(
      "SELECT status FROM flight_import WHERE id = ANY($1) AND status = 'pending'",
      [importIds],
    );
    expect(rows).toHaveLength(1);
  });

  it('rolls back all rows when writing the result fails', async () => {
    // One connection only, so a missing ROLLBACK would show the uncommitted rows to the next query.
    const single = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });
    const importId = randomUUID();
    await single.query("INSERT INTO flight_import (id, file_name, size) VALUES ($1, 'f.csv', 1)", [
      importId,
    ]);
    importIds.push(importId);
    const failing = {
      query: single.query.bind(single),
      connect: async () => {
        const client = await single.connect();
        const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
        client.query = ((text: unknown, ...rest: unknown[]) =>
          typeof text === 'string' && text.includes('SET status')
            ? Promise.reject(new Error('write failed'))
            : query(text, ...rest)) as typeof client.query;
        return client;
      },
    } as unknown as pg.Pool;
    const csv = [HEADER, row(registration, '2026-10-04')].join('\n');
    await expect(
      processImport({ pool: failing, readObject: async () => csv }, importId),
    ).rejects.toThrow('write failed');
    const { rows } = await single.query('SELECT 1 FROM flight WHERE import_id = $1', [importId]);
    expect(rows).toHaveLength(0);
    await single.end();
  });

  it('ignores an unknown import', async () => {
    const outcome = await processImport({ pool, readObject: async () => '' }, randomUUID());
    expect(outcome).toBe('unknown');
  });
});
