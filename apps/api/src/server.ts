import { createClient } from 'redis';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createPool } from './db.ts';
import { createS3Client, createStorage } from './storage.ts';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
// Without a command queue a Redis outage fails fast and the API falls back to the database.
const redis = config.REDIS_URL
  ? createClient({ url: config.REDIS_URL, disableOfflineQueue: true })
  : undefined;
const app = await buildApp({
  pool,
  redis,
  storage: createStorage(createS3Client(), config.S3_BUCKET),
  logLevel: config.LOG_LEVEL,
  rateLimitMax: config.RATE_LIMIT_MAX,
});

redis?.on('error', (err) => app.log.warn({ err }, 'redis client error'));
// Not awaited: the client keeps reconnecting in the background, requests fall back meanwhile.
redis?.connect().catch((err: unknown) => app.log.warn({ err }, 'redis connection failed'));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    if (redis?.isOpen) await redis.quit();
    await pool.end();
  });
}

await app.listen({ host: config.HOST, port: config.PORT });
