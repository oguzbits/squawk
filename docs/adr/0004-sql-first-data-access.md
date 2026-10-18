# ADR 0004: SQL-first data access with node-pg-migrate

- Status: accepted
- Date: 2026-10-18

## Context

The API reads and writes PostgreSQL. The data model is small, but queries will be analysed with `EXPLAIN ANALYZE` in a performance case study, so the executed SQL should be visible in the code.

## Options

1. **ORM (Prisma, TypeORM).** Generated types and migrations, but SQL is hidden behind the ORM and its query engine.
2. **Typed query builder (Kysely, Drizzle).** Good type safety, SQL is still generated.
3. **`pg` with hand-written SQL, migrations as plain SQL files (node-pg-migrate).** SQL is explicit; row types are declared by hand and mapped to the shared API schemas.

## Decision

Option 3. `pg` with parameterised queries, row interfaces next to the query and a mapper to the shared Zod types. Migrations are `.sql` files with `-- Up Migration` / `-- Down Migration` sections, applied by node-pg-migrate's programmatic runner (advisory lock, ordered, recorded in `pgmigrations`). Demo data lives in `apps/api/seed/`, separate from migrations.

## Consequences

- Queries in code match what `EXPLAIN ANALYZE` analyses, one to one.
- Row types are not generated; integration tests cover the mapping.
- Integration tests run migrations themselves, so they work on a fresh database.

## When to revisit

- With many tables and complex dynamic filters, Kysely would be introduced for type-checked queries while keeping SQL migrations.
- If several services shared the schema, generated types from the database (e.g. `kanel`) would replace hand-written row types.
