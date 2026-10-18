import { loadEnv } from 'vite';
import { loadConfig } from '../src/config.ts';
import { migrate } from '../src/db.ts';

// Runs once before all test files, so a fresh database works and parallel files do not race.
export default async function setup(): Promise<void> {
  await migrate(loadConfig(loadEnv('test', '../..', '')).DATABASE_URL);
}
