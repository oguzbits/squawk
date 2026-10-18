import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createPool } from './db.ts';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const app = await buildApp({
  pool,
  logLevel: config.LOG_LEVEL,
  rateLimitMax: config.RATE_LIMIT_MAX,
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await pool.end();
  });
}

await app.listen({ host: config.HOST, port: config.PORT });
