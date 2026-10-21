# Due-date dashboard with Redis cache

Status: approved design, 2026-10-21. Decision record for the cache: ADR 0008 (written with the implementation).

## Goal

Show, fleet-wide, which maintenance tasks are overdue, due soon or fine. Remaining margins come from the imported flights. The dashboard is cached in Redis (ElastiCache on Floci) with an invalidation that cannot serve stale data after a change, and its performance is measured before and after.

## Scope

In: maintenance tasks with intervals, due-date rule, dashboard endpoint, marking a task done, Redis cache with invalidation and fallback, load measurement, dashboard view, docs.

Out: creating and editing tasks through the API (tasks come from the seed script), per-user views, notifications (separate roadmap item), task history (only the last completion is kept).

## Data model

`maintenance_task`: `id`, `aircraft_id`, `name`, `interval_hours`, `interval_cycles`, `interval_days` (all nullable, `CHECK` at least one is set and all are positive), `last_done_at timestamptz NOT NULL`.

Usage since the last completion is not stored. It is aggregated from `flight` in SQL: block hours (`block_off >= last_done_at`) and cycles of the same flights.

## Due rule

Pure function `computeDue(task, usage, now)` in `packages/shared`, no I/O.

- For every set interval: remaining = interval − usage (hours, cycles, days since `last_done_at`).
- Relative remaining = remaining / interval. The governing interval is the one with the smallest relative remaining.
- Status: `overdue` if any remaining < 0, `due-soon` if the smallest relative remaining ≤ 10 %, otherwise `ok`.
- Result: `{ status, governing: 'hours' | 'cycles' | 'days', remaining }`.

## API

- `GET /dashboard/due` returns `{ computedAt, items: [{ taskId, taskName, aircraftId, registration, status, governing, remaining }] }`, sorted overdue first, then by smallest relative remaining, then by registration.
- `POST /maintenance-tasks/:id/complete` sets `last_done_at = now()` and invalidates the cache. 404 for an unknown task. Repeating it is harmless.

Aggregation and filtering run in PostgreSQL. The pure rule runs in Node with `now` as a parameter.

## Cache

Cache-aside in the API. Client: `redis` (node-redis) behind a small `DueCache` interface (`get`, `set`, `invalidate`) so tests can use the real thing and the fallback is testable.

- Key `due:v{N}`, where `N` is the value of the counter `due:version`. TTL 5 minutes, as a backstop only.
- Read: get `due:version`, get `due:v{N}`; on a miss compute from the database and `SET … EX`.
- Invalidate: `INCR due:version` after the database commit. A reader that computed from older data writes under the old version number, which is never read again. This avoids the race of "delete the key, then a slow reader writes stale data back".
- Writers: the API (task completion) and the import Lambda (after the import transaction commits). In the Lambda it is best effort: a failure is logged and the TTL bounds the staleness. It must not fail the message, because the import is already committed and a retry would be skipped as already processed.
- Fallback: if Redis is unavailable, the API computes from the database and logs a warning. No silent catch.

## Performance case study

A seed script generates a large fleet (target: hundreds of aircraft, tens of tasks each, tens of thousands of flights). `autocannon` measures `GET /dashboard/due` (p50, p99, requests per second) in three states, each in its own commit:

1. Deliberately slow: one query per task (N+1). Allowed by AGENTS.md as the case study.
2. One SQL query with aggregation.
3. With the cache (hit path).

Results go into the docs with the data set size and machine caveats.

## Web

A dashboard section with a table (aircraft, task, status badge, remaining with unit) and a "Mark done" button per row. It handles empty, loading, error with retry and pending states. Marking done invalidates the query through TanStack Query.

## Infrastructure

Bootstrap creates the ElastiCache cluster in Floci and the Lambda gets `REDIS_URL` (reachable through the Floci network, as the database is). Findings and gaps go into `docs/floci-notes.md`. A spike comes first: does Floci start Redis, on which host and port, reachable from the host and from a Lambda container?

## Tests

- `computeDue`: boundaries (exactly 10 %, exactly 0), each interval type alone, several intervals, governing choice. Breaking the threshold or the sign makes a test red.
- SQL aggregation against Postgres: flights before `last_done_at` are ignored, other aircraft do not leak in.
- Cache against Redis: hit, miss, TTL set, invalidation makes the next read recompute, a write under an old version is not served (this test fails if the version counter is replaced by a plain key delete), fallback when Redis is down.
- Import pipeline: a completed import invalidates the cache.
- Web: the four states and the done action.

## Risks

- Floci may not emulate ElastiCache well. Fallback plan: Redis as a plain container, documented as a gap, with an ADR update.
- The load numbers depend on the machine; only the ratios between the three states are meaningful.
