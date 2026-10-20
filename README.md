# Squawk

Squawk is a small maintenance and defect reporting system for an aircraft fleet. A _squawk_ is the aviation term for a defect report written by the crew.

The project is a reference implementation of a TypeScript stack on AWS: Node.js (Fastify), React, PostgreSQL on RDS, S3 uploads via presigned URLs, and later SQS, Lambda, ElastiCache and DynamoDB. Everything runs locally against [Floci](https://floci.io), a local AWS emulator. No AWS account is needed.

## Architecture

```mermaid
flowchart LR
  browser[Browser<br/>React + TanStack Query] -->|/api via Vite proxy| api[API<br/>Fastify + Zod]
  api -->|SQL| rds[(RDS PostgreSQL 16)]
  api -->|presigned POST, HeadObject| s3[(S3 bucket)]
  browser -->|upload via presigned POST| s3
  subgraph floci[Floci - local AWS on :4566]
    rds
    s3
  end
```

- The web app (`apps/web`) fetches data through a typed API layer that validates every response against the shared Zod schemas (`packages/shared`).
- The API (`apps/api`) serves JSON, validates input and output with the same schemas, and writes structured JSON logs with a correlation ID (`x-request-id`, taken from the request if valid, otherwise generated, and returned in the response).
- Defect attachments (JPEG, PNG, PDF, up to 10 MB) never pass through the API. The API returns a presigned POST whose policy fixes key, content type and exact size; the browser uploads to S3 directly and then confirms the upload, which the API verifies against the stored object.
- PostgreSQL runs as an RDS instance inside Floci. Floci starts a real Postgres container and exposes it through a proxy port on `127.0.0.1:7001`.

## Quickstart

Prerequisites: Docker, Node.js 24 or newer, pnpm (`corepack enable`). The [Floci CLI](https://github.com/floci-io/floci-cli) is optional and useful for diagnostics (`floci doctor`).

```sh
pnpm install
pnpm env:up   # starts Floci, creates the RDS instance, applies migrations and demo data
pnpm dev      # API on http://localhost:3000, web on http://localhost:5173
```

`pnpm env:up` creates `.env` from `.env.example` if it does not exist, and creates the attachments bucket. All AWS credentials in it are dummy values for Floci.

Stop everything with `pnpm env:down`. Floci keeps its state in memory, so the next `pnpm env:up` starts from a clean database.

## Tests and checks

```sh
pnpm test        # unit, component and integration tests (integration tests need pnpm env:up)
pnpm lint        # ESLint and Prettier
pnpm typecheck   # tsc in strict mode for every package
```

## API

| Method | Path                               | Description                                                                                                   |
| ------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/health`                          | `200` if the database is reachable, otherwise `503`. Not rate-limited.                                        |
| `GET`  | `/aircraft`                        | All aircraft, sorted by registration.                                                                         |
| `GET`  | `/defects`                         | Defects, newest first; optional `?aircraftId=`. Attachments carry a signed download link.                     |
| `POST` | `/defects`                         | Creates a defect. With an `attachment` declaration (name, type, size) the response includes a presigned POST. |
| `POST` | `/defects/:id/attachment/complete` | Confirms the upload after verifying size and type of the stored object. Idempotent.                           |

All endpoints except `/health` are rate-limited (`RATE_LIMIT_MAX` requests per minute and client, default 100).

## Repository layout

```
apps/api/          Fastify API, SQL migrations, demo data
apps/web/          React app (Vite)
packages/shared/   Zod schemas shared by API and web
scripts/           Local environment bootstrap
docs/adr/          Architecture decision records
docs/floci-notes.md
```

## Documentation

- [ADR 0001: Run Floci with Docker Compose](docs/adr/0001-run-floci-with-docker-compose.md)
- [ADR 0002: PostgreSQL through Floci RDS](docs/adr/0002-postgres-via-floci-rds.md)
- [ADR 0003: Run TypeScript natively on Node.js](docs/adr/0003-native-typescript-execution.md)
- [ADR 0004: SQL-first data access with node-pg-migrate](docs/adr/0004-sql-first-data-access.md)
- [ADR 0005: Presigned POST instead of upload through the API](docs/adr/0005-presigned-post-instead-of-upload-through-api.md)
- [ADR 0006: Explicit upload confirmation instead of S3 events](docs/adr/0006-explicit-upload-confirmation.md)
- [Floci notes](docs/floci-notes.md): verified emulator behaviour, gaps and workarounds

## Roadmap

| Status  | Milestone                                                                                 |
| ------- | ----------------------------------------------------------------------------------------- |
| Done    | Foundation: monorepo, local environment, API with health check, migrations, aircraft list |
| Done    | Defect reports with photo/PDF upload via S3 presigned URLs                                |
| Planned | Flight data import (CSV) via SQS and Lambda, idempotency, dead-letter queue               |
| Planned | Due-date dashboard with Redis cache, invalidation and load measurement                    |
| Planned | Audit log in DynamoDB                                                                     |
| Planned | Terraform for all resources and a GitHub Actions pipeline                                 |
| Planned | Daily due-date notification via EventBridge Scheduler and SNS                             |
