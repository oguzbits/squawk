import { loadConfig } from './config.ts';
import { migrate } from './db.ts';

await migrate(loadConfig().DATABASE_URL);
console.log('Migrations applied');
