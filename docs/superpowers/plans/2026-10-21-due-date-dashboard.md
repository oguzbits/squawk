# Due-date dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fleet-wide due-date dashboard over maintenance tasks, cached in Redis (ElastiCache on Floci) with a version-counter invalidation, and measured in three states.

**Architecture:** Maintenance tasks hold intervals and `last_done_at`; usage is aggregated from `flight` in SQL; a pure rule in `packages/shared` turns usage into a status. The API serves `GET /dashboard/due` with cache-aside on a versioned key; the API and the import Lambda bump the version after writes.

**Tech Stack:** PostgreSQL via `pg`, Fastify + Zod, `redis` (node-redis), ElastiCache on Floci, autocannon, React + TanStack Query.

**Spec:** [docs/superpowers/specs/2026-10-21-due-date-dashboard-design.md](../specs/2026-10-21-due-date-dashboard-design.md)

## Global Constraints

- Strict TypeScript, erasable syntax only, no `any`, no `@ts-ignore`; `pnpm` only; commit on `main`, small Conventional Commits, each one reversible.
- Run `pnpm lint`, `pnpm typecheck`, `pnpm test` before every commit; never `--no-verify`.
- Rules are pure functions with `now` as a parameter. Routes stay thin. Filtering and aggregation in PostgreSQL; the N+1 variant exists only as the deliberately slow case-study commit (Task 3).
- Status thresholds: `overdue` if any remaining < 0; `due-soon` if smallest relative remaining ≤ 10 %; otherwise `ok`.
- Cache: key `due:v{N}` with `N` from the counter `due:version`; TTL 5 minutes; invalidation is `INCR due:version` after the database commit. Redis down: compute from the database, log a warning.
- Config only in `apps/api/src/config.ts`; the endpoint is never hard-coded. Logs are structured JSON with correlation ID, no `console` in application code.
- Every web view handles empty, loading, error with retry and pending.
- No learning content in the repo. Docs in English.
- Each guard test must go red when the guard is broken by hand; a test that cannot fail is deleted.

## Review Focus

- Task with two intervals where the hours interval is fine but days are overdue: status must be `overdue`, governing `days`.
- Flights exactly at `last_done_at`: counted (spec: `block_off >= last_done_at`).
- Aircraft with no flights and tasks with only a days interval: usage 0 hours/cycles, no division by zero or `NaN`.
- Task completed twice in a row: second call succeeds, cache still consistent.
- Redis returns a corrupt or schema-invalid cached value: treated as a miss, recomputed, logged.

---

### Task 1: Spike - ElastiCache on Floci

Output is an answer, not kept code (throwaway script deleted afterwards).

**Files:**

- Modify: `docs/floci-notes.md` (new section "ElastiCache")

- [ ] **Step 1:** With a throwaway script, create a Redis replication group or cluster through `@aws-sdk/client-elasticache`; record: does it start a container, status transitions, reported endpoint and port, whether the port is published to the host (compose publishes `7001-7005` only), reachability from the host and from a Lambda container (`floci:<port>`), and whether `INCR`/`GET`/`SET EX` work with `redis`.
- [ ] **Step 2:** Decide and record: ElastiCache usable (note port range to publish in `docker-compose.yml`) or fallback to a plain Redis container (then add an ADR note and tell the user, since this changes the AWS-service scope).
- [ ] **Step 3:** Delete the spike script. Commit `docs: record Floci findings for ElastiCache`.

Verification: findings table in `docs/floci-notes.md`; `git status` clean afterwards.

### Task 2: Maintenance model and due rule

**Files:**

- Create: `apps/api/migrations/<timestamp>_create-maintenance-task.sql`
- Create: `packages/shared/src/maintenance.ts`, `packages/shared/src/maintenance.test.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/package.json` (add vitest and a `test` script)

**Interfaces:**

- Produces (shared):
  - `type DueStatus = 'overdue' | 'due-soon' | 'ok'`; `type Governing = 'hours' | 'cycles' | 'days'`
  - `computeDue(task: { intervalHours: number | null; intervalCycles: number | null; intervalDays: number | null }, usage: { hours: number; cycles: number; days: number }, ): { status: DueStatus; governing: Governing; remaining: number }`
  - `dueItemSchema`, `dueDashboardSchema` (`{ computedAt, items }`) and inferred types; item fields `taskId, taskName, aircraftId, registration, status, governing, remaining`.
  - `DUE_SOON_RATIO = 0.1`.

- [ ] **Step 1:** Migration `maintenance_task` as in the spec (`id uuid`, `aircraft_id` FK, `name`, three nullable interval columns, `last_done_at timestamptz NOT NULL`, `CHECK` at least one interval set and each positive; index on `aircraft_id`).
- [ ] **Step 2 (tests first), `computeDue`:** exactly 10 % remaining is `due-soon`; just above is `ok`; remaining exactly 0 is `due-soon` (not overdue); remaining -1 is `overdue`; each interval type alone; hours fine but days overdue gives `overdue` with governing `days`; with several intervals the smallest relative remaining governs; usage 0 with only a days interval gives no `NaN`.
- [ ] **Step 3:** Implement `computeDue`; run the tests.
- [ ] **Step 4:** Red check by hand: change the threshold comparison from `<=` to `<`, flip the overdue sign, take the largest instead of the smallest ratio; each must fail a test.
- [ ] **Step 5:** Commit `feat(shared): add maintenance schemas and the due rule`.

### Task 3: Dashboard endpoint, load seed and the deliberately slow variant

**Files:**

- Create: `apps/api/src/routes/dashboard.ts`, `apps/api/src/due.ts`, `apps/api/test/dashboard.integration.test.ts`, `scripts/load-seed.ts`, `scripts/load-dashboard.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/seed/demo.sql` (a few tasks for the demo aircraft), `package.json` (scripts `load:seed`, `load:measure`), root devDependency `autocannon`

**Interfaces:**

- Produces: `loadDueItems(pool: pg.Pool, now: Date): Promise<DueItem[]>` in `apps/api/src/due.ts` (sorted: overdue first, then smallest relative remaining, then registration); route `GET /dashboard/due` -> `dueDashboardSchema`. The route calls `loadDueItems`; Task 4 and 6 replace its internals or wrap it.
- `scripts/load-seed.ts` generates N aircraft (default 300), M tasks each (default 20) and F flights per aircraft (default 150) with marker registrations so it can remove them; refuses non-local endpoints like the bootstrap script.

- [ ] **Step 1 (tests first), integration against Floci's Postgres:** a task with usage from flights after `last_done_at` yields the expected status; a flight before `last_done_at` is ignored; a flight exactly at `last_done_at` is counted; another aircraft's flights do not leak; ordering as in the spec.
- [ ] **Step 2:** Implement `loadDueItems` in the deliberately slow form: one query for tasks, then one usage query per task (N+1). Comment it as the case-study baseline. Tests green.
- [ ] **Step 3:** Write `load-seed` and `load-dashboard` (autocannon, fixed duration and connections, prints p50, p99, requests per second). Run both, record the baseline numbers and data set size.
- [ ] **Step 4:** Commit `perf(api): add the dashboard with a deliberately slow N+1 query as baseline` (the measurement script and seed in the same commit; numbers go into the docs in Task 9).

### Task 4: One-query dashboard

**Files:**

- Modify: `apps/api/src/due.ts`

**Interfaces:** `loadDueItems` signature unchanged.

- [ ] **Step 1:** Replace the per-task queries with one SQL statement that aggregates hours and cycles per task from `flight` (`LEFT JOIN LATERAL` or grouped join with `block_off >= last_done_at`), days computed from `now` as parameter. Existing tests from Task 3 must pass unchanged.
- [ ] **Step 2:** Measure with `load:measure`, keep the numbers.
- [ ] **Step 3:** Commit `perf(api): compute dashboard usage in a single query`.

### Task 5: Complete a task

**Files:**

- Create: `apps/api/src/routes/maintenance.ts`, `apps/api/test/maintenance.integration.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**

- Produces: `POST /maintenance-tasks/:id/complete` -> 200 `{ taskId, lastDoneAt }`, 404 `errorSchema` for an unknown task. Route accepts an optional `onChange: () => Promise<void>` dependency (a no-op until Task 6) so the cache invalidation hooks in without a second route change.

- [ ] **Step 1 (tests first):** completing sets `last_done_at` so a previously overdue task becomes `ok` in `loadDueItems`; unknown task answers 404; a second call succeeds; invalid UUID answers 400.
- [ ] **Step 2:** Implement; tests green. Red check: remove the `UPDATE`, the first test must fail.
- [ ] **Step 3:** Commit `feat(api): mark a maintenance task as done`.

### Task 6: Redis cache with versioned keys

**Files:**

- Create: `apps/api/src/cache.ts`, `apps/api/test/cache.integration.test.ts`
- Modify: `apps/api/src/config.ts` (`REDIS_URL`, optional), `.env.example`, `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/src/routes/dashboard.ts`, `scripts/bootstrap-local.ts` (ElastiCache per Task 1), `docker-compose.yml` (published port if needed), `apps/api/package.json` (`redis`)

**Interfaces:**

- Produces:
  - `interface DueCache { get(): Promise<DueDashboard | null>; set(value: DueDashboard): Promise<void>; invalidate(): Promise<void> }`
  - `createDueCache(client: RedisClientType, log: FastifyBaseLogger): DueCache`
  - `get` reads `due:version` first and remembers nothing; `set` takes the version read in the same call chain, so a reader's `get` returns a token internally: keep `get`/`set` as a pair via a returned `{ value, store(next) }` if that is simpler, but the stale-writer behavior below must hold.
  - `AppOptions.cache?: DueCache`; without it the route computes directly.
- Behavior: miss computes and stores; a cached value that fails `dueDashboardSchema` is a miss and logged; any Redis error logs a warning and falls back to the database; the response never fails because of Redis.

- [ ] **Step 1 (tests first), against Redis in Floci:** hit returns the stored value without querying Postgres (spy on the pool); miss then hit; TTL is set (about 300 s); `invalidate` makes the next read recompute; a value written by a reader that started before an `invalidate` is not served afterwards (simulate by `get` before, `invalidate`, then `set` from the old reader); corrupt cached JSON is a miss; Redis unreachable (client pointed at a closed port) still answers 200 from the database and logs a warning.
- [ ] **Step 2:** Implement `createDueCache` and wire the route (`computedAt` from `now`). Complete endpoint (Task 5) gets `onChange: cache.invalidate`.
- [ ] **Step 3:** Red checks: replace `INCR due:version` by `DEL` of the current key, the stale-writer test must fail; remove the schema check, the corrupt-value test must fail; remove the fallback, the Redis-down test must fail.
- [ ] **Step 4:** Measure (cache warm), keep numbers.
- [ ] **Step 5:** Commit `feat(api): cache the dashboard in Redis with a versioned key`.

### Task 7: Invalidate from the import Lambda

**Files:**

- Modify: `apps/importer/src/process.ts`, `apps/importer/src/handler.ts`, `apps/importer/package.json` (`redis`), `scripts/bootstrap-local.ts` (`REDIS_URL` in the function environment, host `floci` or per Task 1), `apps/importer/src/process.integration.test.ts`, `apps/api/test/imports.pipeline.integration.test.ts`

**Interfaces:**

- Consumes: key names `due:version` from Task 6.
- Produces: `ImportDeps.invalidateDueCache?: () => Promise<void>`; called by `processImport` after COMMIT when the outcome is `completed`, errors are logged and swallowed there (documented best effort; never changes the outcome).

- [ ] **Step 1 (tests first):** after a completed import `invalidateDueCache` was called once; for `already-processed`, `unknown` and `failed` it is not called; a throwing invalidator does not change the outcome or roll back; pipeline test: warm the dashboard cache through the API, upload a CSV that changes a task's usage, the next dashboard read reflects it.
- [ ] **Step 2:** Implement; handler creates the Redis client once per container from `REDIS_URL` (absent -> no invalidation, logged once).
- [ ] **Step 3:** Red check: remove the call, the pipeline test must fail.
- [ ] **Step 4:** Commit `feat(importer): invalidate the dashboard cache after an import`.

### Task 8: Dashboard view

**Files:**

- Create: `apps/web/src/DueDashboard.tsx`, `apps/web/src/DueDashboard.test.tsx`
- Modify: `apps/web/src/api.ts` (`fetchDueDashboard`, `completeTask`), `apps/web/src/App.tsx`

**Interfaces:**

- Consumes: `dueDashboardSchema`, `POST /maintenance-tasks/:id/complete`.

- [ ] **Step 1 (tests first):** loading state; empty state; error with a working retry; rows show registration, task, status text (not color alone) and remaining with unit; "Mark done" disables while pending and refetches the dashboard on success; a failed completion shows an alert and keeps the row.
- [ ] **Step 2:** Implement; tests green. Red check: drop the query invalidation after completion, the refetch test must fail.
- [ ] **Step 3:** Check once in a browser with `pnpm dev` (status badges, done action); commit `feat(web): add the due-date dashboard`.

### Task 9: Documentation

**Files:**

- Create: `docs/adr/0008-redis-dashboard-cache-with-versioned-keys.md`
- Modify: `README.md` (architecture diagram and bullets, API table, roadmap "Done", documentation links, load results section), `docs/floci-notes.md` if new findings, `.env.example` comments

- [ ] **Step 1:** ADR 0008 (context, options TTL / delete / version counter, decision, consequences, when to decide differently), including the Lambda best-effort rule and the Redis-down fallback.
- [ ] **Step 2:** README: results table for the three states (baseline N+1, one query, cached) with data set size and the caveat that only ratios matter; roadmap row to Done.
- [ ] **Step 3:** `pnpm lint && pnpm typecheck && pnpm test`; commit `docs: describe the due-date dashboard and the cache`.

---

## Self-review

- Spec coverage: data model (T2), rule (T2), endpoints (T3/T5), cache + fallback + versioned key (T6), Lambda invalidation best effort (T7), three-state measurement (T3/T4/T6/T9), web (T8), infrastructure and spike (T1/T6), tests per spec, docs (T9). Out-of-scope items are not planned.
- Types: `DueItem`, `DueDashboard`, `computeDue`, `DueCache`, `loadDueItems`, `invalidateDueCache` are defined once and reused with the same names.
- Open choice for the implementer, intentionally: how `get`/`set` carry the version token (see Task 6); the stale-writer test defines the required behavior.
