import { DUE_CACHE_PREFIX, dueDashboardSchema, type DueDashboard } from '@squawk/shared';
/** The three commands the cache uses; the node-redis client satisfies it. */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  incr(key: string): Promise<number>;
}

export interface CacheLog {
  warn(obj: object, msg: string): void;
}

export interface DueCacheRead {
  value: DueDashboard | null;
  /** Stores under the version that was current when this read started. */
  store(value: DueDashboard): Promise<void>;
}

export interface DueCache {
  read(): Promise<DueCacheRead>;
  invalidate(): Promise<void>;
}

const TTL_SECONDS = 300;

// Redis problems never fail a request: they are logged and the caller computes from the database.
export function createDueCache(
  redis: RedisClient,
  log: CacheLog,
  prefix = DUE_CACHE_PREFIX,
): DueCache {
  const versionKey = `${prefix}:version`;
  const dataKey = (version: number) => `${prefix}:v${version}`;

  return {
    async read() {
      let version = 0;
      let value: DueDashboard | null = null;
      try {
        version = Number((await redis.get(versionKey)) ?? 0);
        const raw = await redis.get(dataKey(version));
        if (raw !== null) {
          const parsed = dueDashboardSchema.safeParse(JSON.parse(raw));
          if (parsed.success) value = parsed.data;
          else log.warn({ key: dataKey(version) }, 'cached dashboard does not match the schema');
        }
      } catch (err) {
        log.warn({ err }, 'dashboard cache read failed');
      }
      return {
        value,
        async store(next) {
          try {
            await redis.set(dataKey(version), JSON.stringify(next), { EX: TTL_SECONDS });
          } catch (err) {
            log.warn({ err }, 'dashboard cache write failed');
          }
        },
      };
    },

    // A new version number orphans everything a slower reader might still write under the old one.
    async invalidate() {
      try {
        await redis.incr(versionKey);
      } catch (err) {
        log.warn({ err }, 'dashboard cache invalidation failed; entries expire after the TTL');
      }
    },
  };
}
