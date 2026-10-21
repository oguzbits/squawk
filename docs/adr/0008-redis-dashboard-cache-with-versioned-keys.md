# ADR 0008: Dashboard cache in Redis with versioned keys

- Status: accepted
- Date: 2026-10-21

## Context

`GET /dashboard/due` aggregates flight usage for every maintenance task of the fleet. It is read often and changes only when an import completes or a task is marked done. Measured on 300 aircraft, 6000 tasks and 45000 flights, one query already brings it from 4167 ms to 251 ms (p50), but the result is the same for every reader until the next write.

## Options

1. **TTL only.** Simple, but a user who just marked a task as done sees the old status until the entry expires.
2. **Delete the key on every write.** Fresh after a write, but there is a race: a reader that computed from older data before the commit can store its result after the delete and keep serving it until the TTL.
3. **Version counter in the key.** A write increments `due:version`; readers store under `due:v{N}` with the version they read first. A slow reader writes under an old version that nobody reads again.

## Decision

Option 3, on ElastiCache (Redis) with a TTL of 5 minutes as a backstop.

- The API reads `due:version`, then `due:v{N}`; on a miss it computes from the database and stores under the same `N`.
- The API (task completed) and the import Lambda (after the import transaction commits) run `INCR due:version`. The prefix lives in `packages/shared` so both sides agree.
- A cached value that does not match the response schema is a miss and is logged.
- Redis is optional and never required: with `REDIS_URL` unset, or when a Redis call fails, the API computes from the database and logs a warning. The client has no offline command queue, so an outage fails fast instead of hanging requests.
- In the Lambda the invalidation is best effort. The import is already committed, and a retry would be skipped as already processed, so a failed `INCR` is logged and the TTL bounds the staleness.

## Consequences

- Reads after a write are fresh, and the stale-writer race cannot serve old data.
- Superseded versions are not deleted; they expire with their TTL.
- Without Redis the dashboard still works at the single-query speed.
- Writes that bypass the API and the importer (manual SQL) are only visible after the TTL or a manual `INCR due:version`.
- A failed invalidation (Redis down while a task is completed) can leave a value that is served for up to five minutes once Redis is back.
- The whole fleet is one cache entry. Per-aircraft keys would be needed if the payload became large or filtered per user.

## When to revisit

- Per-user or per-aircraft views: key by filter, or cache the aggregation per aircraft.
- Staleness must be zero even when Redis is unavailable: invalidate in the same transaction through an outbox, or give up the cache for this view.
- Many writers per second: replace `INCR`-per-write with batching, since each write orphans the cached entry.
