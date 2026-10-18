import pg from 'pg';
import { runner } from 'node-pg-migrate';

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 2_000 });
}

export async function migrate(databaseUrl: string): Promise<void> {
  await runner({
    databaseUrl,
    dir: new URL('../migrations', import.meta.url).pathname,
    migrationsTable: 'pgmigrations',
    direction: 'up',
    log: () => {},
  });
}
