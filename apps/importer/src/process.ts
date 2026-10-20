import { IMPORT_MAX_REJECTIONS } from '@squawk/shared';
import type pg from 'pg';
import { parseFlightCsv, type RejectedRow } from './parse.ts';

export interface ImportDeps {
  pool: pg.Pool;
  readObject(key: string): Promise<string>;
}

export type ImportOutcome = 'completed' | 'failed' | 'unknown' | 'already-processed';

export const importKey = (id: string) => `imports/${id}.csv`;

export async function processImport(deps: ImportDeps, importId: string): Promise<ImportOutcome> {
  const { pool } = deps;
  const current = await pool.query<{ status: string }>(
    'SELECT status FROM flight_import WHERE id = $1',
    [importId],
  );
  if (!current.rows[0]) return 'unknown';
  // Queue redelivery and re-sent notifications must not process a file twice.
  if (current.rows[0].status !== 'pending') return 'already-processed';

  let parsed: ReturnType<typeof parseFlightCsv>;
  try {
    parsed = parseFlightCsv(await deps.readObject(importKey(importId)));
  } catch (err) {
    // Only a malformed file is permanent; a failed read propagates so the queue retries it.
    if (!(err instanceof Error) || !err.message.startsWith('unexpected header')) throw err;
    await pool.query(
      `UPDATE flight_import SET status = 'failed', rejections = $2, completed_at = now()
       WHERE id = $1 AND status = 'pending'`,
      [importId, JSON.stringify([{ line: 1, reason: 'unexpected header' }])],
    );
    return 'failed';
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const registrations = [...new Set(parsed.rows.map((r) => r.registration))];
    const aircraft = await client.query<{ id: string; registration: string }>(
      'SELECT id, registration FROM aircraft WHERE registration = ANY($1)',
      [registrations],
    );
    const idByRegistration = new Map(aircraft.rows.map((a) => [a.registration, a.id]));

    const rejected: RejectedRow[] = [...parsed.rejected];
    const valid = parsed.rows.filter((row) => {
      if (idByRegistration.has(row.registration)) return true;
      rejected.push({ line: row.line, reason: 'unknown registration' });
      return false;
    });
    rejected.sort((a, b) => a.line - b.line);

    const inserted = await client.query(
      `INSERT INTO flight (aircraft_id, import_id, block_off, block_on, landings, cycles)
       SELECT aircraft_id, $1, block_off, block_on, landings, cycles
       FROM unnest($2::uuid[], $3::timestamptz[], $4::timestamptz[], $5::int[], $6::int[])
         AS t(aircraft_id, block_off, block_on, landings, cycles)
       ON CONFLICT (aircraft_id, block_off) DO NOTHING`,
      [
        importId,
        valid.map((r) => idByRegistration.get(r.registration)),
        valid.map((r) => r.blockOff),
        valid.map((r) => r.blockOn),
        valid.map((r) => r.landings),
        valid.map((r) => r.cycles),
      ],
    );
    const imported = inserted.rowCount ?? 0;
    await client.query(
      `UPDATE flight_import
       SET status = 'completed', imported = $2, skipped = $3, rejected = $4, rejections = $5,
           completed_at = now()
       WHERE id = $1 AND status = 'pending'`,
      [
        importId,
        imported,
        valid.length - imported,
        rejected.length,
        JSON.stringify(rejected.slice(0, IMPORT_MAX_REJECTIONS)),
      ],
    );
    await client.query('COMMIT');
    return 'completed';
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
