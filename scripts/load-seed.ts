// Fills the local database with a large fleet for load measurements, or removes it again with --clean.
import pg from 'pg';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const MODEL = 'LOAD-TEST';
const url = process.env.DATABASE_URL;
if (!url || !LOCAL_HOSTS.has(new URL(url).hostname)) {
  throw new Error('Refusing to run: DATABASE_URL must point to the local database');
}

const aircraft = Number(process.env.LOAD_AIRCRAFT ?? 300);
const tasksPerAircraft = Number(process.env.LOAD_TASKS ?? 20);
const flightsPerAircraft = Number(process.env.LOAD_FLIGHTS ?? 150);

const pool = new pg.Pool({ connectionString: url });
try {
  await pool.query(
    'DELETE FROM flight WHERE aircraft_id IN (SELECT id FROM aircraft WHERE model = $1)',
    [MODEL],
  );
  await pool.query(
    'DELETE FROM maintenance_task WHERE aircraft_id IN (SELECT id FROM aircraft WHERE model = $1)',
    [MODEL],
  );
  await pool.query('DELETE FROM flight_import WHERE file_name = $1', [MODEL]);
  await pool.query('DELETE FROM aircraft WHERE model = $1', [MODEL]);

  if (!process.argv.includes('--clean')) {
    await pool.query(
      `INSERT INTO aircraft (registration, model, msn)
       SELECT 'LT-' || lpad(g::text, 5, '0'), $2, 'L' || g FROM generate_series(1, $1::int) g`,
      [aircraft, MODEL],
    );
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO flight_import (id, file_name, size, status) VALUES (gen_random_uuid(), $1, 1, 'completed') RETURNING id",
      [MODEL],
    );
    await pool.query(
      `INSERT INTO flight (aircraft_id, import_id, block_off, block_on, landings, cycles)
       SELECT a.id, $2, date_trunc('hour', now()) - g * interval '10 hours',
              date_trunc('hour', now()) - g * interval '10 hours' + interval '90 minutes', 1, 1
       FROM aircraft a CROSS JOIN generate_series(1, $1::int) g WHERE a.model = $3`,
      [flightsPerAircraft, rows[0]?.id, MODEL],
    );
    // Odd tasks have a cycles interval, even tasks a days interval; every task has hours.
    await pool.query(
      `INSERT INTO maintenance_task (aircraft_id, name, interval_hours, interval_cycles, interval_days, last_done_at)
       SELECT a.id, 'Task ' || g, 100 + g * 50, CASE WHEN g % 2 = 1 THEN 50 + g * 10 END,
              CASE WHEN g % 2 = 0 THEN 30 + g * 10 END, now() - g * interval '5 days'
       FROM aircraft a CROSS JOIN generate_series(1, $1::int) g WHERE a.model = $2`,
      [tasksPerAircraft, MODEL],
    );
    console.log(
      `Seeded ${aircraft} aircraft, ${aircraft * tasksPerAircraft} tasks, ${aircraft * flightsPerAircraft} flights`,
    );
  } else {
    console.log('Load-test data removed');
  }
} finally {
  await pool.end();
}
