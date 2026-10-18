import { readFile } from 'node:fs/promises';
import { loadConfig } from './config.ts';
import { createPool } from './db.ts';

const pool = createPool(loadConfig().DATABASE_URL);
try {
  await pool.query(await readFile(new URL('../seed/demo.sql', import.meta.url), 'utf8'));
  console.log('Demo data seeded');
} finally {
  await pool.end();
}
