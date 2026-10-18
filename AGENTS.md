# Agent Rules

Canonical instructions for coding agents in this repo. `CLAUDE.md` only imports this file. Use `pnpm`, never `npm` or `yarn`.

## Commands

| Command          | Purpose                                                               |
| ---------------- | --------------------------------------------------------------------- |
| `pnpm env:up`    | Start Floci, create bucket and RDS instance, migrate, seed demo data  |
| `pnpm env:down`  | Remove Floci and the containers it started                            |
| `pnpm dev`       | API on :3000, web on :5173                                            |
| `pnpm test`      | All tests. Integration tests need `pnpm env:up` and run against Floci |
| `pnpm lint`      | ESLint and Prettier                                                   |
| `pnpm typecheck` | `tsc` in strict mode for every package                                |

Run lint, typecheck and test before every commit. Never skip hooks with `--no-verify`.

## Architecture

- `packages/shared`: Zod schemas and inferred types, the contract between API and web. Derive types with `z.infer`, do not write parallel types.
- `apps/api`: routes are thin (parse input with Zod, call logic, format the response). Rules such as due-date calculation or import validation are pure functions that receive their inputs and the current time as parameters, so tests can fix the clock.
- `apps/web`: server state only through TanStack Query; all HTTP goes through the typed layer in `api.ts`, which validates responses against the shared schemas.
- `apps/api` and `apps/web` never import each other's runtime code.
- SQL is written by hand with `pg` ([ADR 0004](docs/adr/0004-sql-first-data-access.md)). Filtering and aggregation run in PostgreSQL. No N+1 queries, except the deliberately slow variant of the performance case study, which lives in its own commit.
- YAGNI. Extract an abstraction on the third identical use. No additional AWS services without asking.

## Rules

- Strict TypeScript with erasable syntax only ([ADR 0003](docs/adr/0003-native-typescript-execution.md)). No `any`, no `@ts-ignore`.
- Configuration is read in `apps/api/src/config.ts`. The AWS SDK reads endpoint and credentials from the environment itself; the endpoint is never hard-coded.
- Validate all input at the boundary with Zod. Error responses never leak internals.
- Fail fast: errors propagate. No silent `catch`. Allowed exceptions are documented fallbacks (such as Redis to database) that log, and best-effort cleanup.
- Logs are structured JSON with a correlation ID. They never contain file or document content. No `console` in application code.
- Every async view in the web app handles empty, loading, error (with retry) and pending states.
- IAM policies follow least privilege even though Floci does not enforce them.

## Floci

- Never work against a real AWS account. Credentials are dummy values, the endpoint comes from `AWS_ENDPOINT_URL`. The bootstrap script refuses non-local endpoints.
- Floci runs through `docker-compose.yml` ([ADR 0001](docs/adr/0001-run-floci-with-docker-compose.md)). Stop it with `pnpm env:down`.
- Before building on a Floci service, spike whether it emulates the needed behavior. Record gaps and workarounds in [docs/floci-notes.md](docs/floci-notes.md).

## Tests

- Assert behavior, not markup. Integration tests use Floci, not mocks of AWS.
- A test of a guard must fail when the guard is removed. Break the code by hand and check that a test goes red. A test that cannot fail, or adds nothing, is deleted.
- One behavior, one test, at the lowest layer that can show it.
- A bug fix starts with a test that fails for the bug.
- UI changes are checked once in a browser. A check that recurs becomes an automated end-to-end test.

## Workflow

- Work directly on `main` in small Conventional Commits, each one reversible with `git revert`. No pull requests and no feature branches.
- Every real architecture decision gets an ADR in `docs/adr/` with context, options, decision, consequences and the conditions under which it would be decided differently.
- Documentation is English, factual and uses relative links. Update docs in the same change as the code. The README roadmap lists what is not built as "Planned"; nothing half-finished on `main`.
- Never commit secrets. Only `.env.example` is tracked.
