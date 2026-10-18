# ADR 0002: PostgreSQL through Floci RDS

- Status: accepted
- Date: 2026-10-18

## Context

The relational data lives in PostgreSQL, which runs on RDS in a real deployment. Locally, Postgres could either be its own container or an RDS instance created in Floci.

## Options

1. **Standalone `postgres` container in Compose.** Fast and familiar, but bypasses RDS entirely: the instance would not exist as an AWS resource, and later infrastructure code could not be tested end to end.
2. **RDS instance in Floci.** Created through the RDS API like in AWS. Floci starts a real `postgres:16-alpine` container behind a proxy port.

## Decision

Option 2. A small idempotent script (`scripts/bootstrap-local.ts`) creates the RDS instance through the AWS SDK. It refuses to run unless `AWS_ENDPOINT_URL` points to a local host. The app connects via `DATABASE_URL`, because the endpoint address Floci reports is the Floci container IP (see [floci-notes](../floci-notes.md)).

## Consequences

- The database is a real AWS resource from day one; integration tests check it through `DescribeDBInstances`.
- Floci uses in-memory state, so the instance and its data are recreated on every `pnpm env:up`. Migrations and demo data are reapplied automatically.
- The bootstrap script is temporary. It is replaced by Terraform when the infrastructure milestone starts.

## When to revisit

- If Floci RDS turned out unreliable (startup failures, proxy issues under load), a standalone Postgres container would be the fallback for local development, keeping RDS only in infrastructure tests.
- If persistent local data became important, Floci's `persistent` storage mode would be evaluated before switching away.
