# Floci notes

Observed behaviour of the local AWS emulator, verified with a spike at the start of each milestone.
Versions: Floci server `2.3.0` (`floci/floci:2.3.0`), CLI `0.4.0`.

## General

| Topic                  | Observation                                                                                                                                                 | Consequence                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Startup                | Ready in well under a second; `GET /_floci/health` returns 200 once ready (also used by `floci doctor`).                                                    | `scripts/bootstrap-local.ts` polls this endpoint.                                                          |
| `floci start`          | Publishes only port 4566. There is no option for additional port mappings.                                                                                  | Floci is started via `docker-compose.yml` instead ([ADR 0001](adr/0001-run-floci-with-docker-compose.md)). |
| CLI compatibility      | `floci doctor`, `floci status`, `floci env` and `floci logs` work against the compose container because it is named `floci`.                                | The CLI stays usable for diagnostics.                                                                      |
| Storage                | Default storage mode is in-memory. All resources are gone after a restart.                                                                                  | Bootstrap is idempotent and runs on every `pnpm env:up`.                                                   |
| IAM                    | Policies are not enforced by default (log: `policy enforcement disabled`). Enforcement can be turned on with `FLOCI_SERVICES_IAM_ENFORCEMENT_ENABLED=true`. | Still to be evaluated once IAM roles exist. Policies are written least-privilege regardless.               |
| AWS SDK for JavaScript | Reads `AWS_REGION`, not `AWS_DEFAULT_REGION` (which is what `floci env` prints).                                                                            | `.env.example` sets `AWS_REGION`.                                                                          |

## RDS (PostgreSQL)

| Topic            | Observation                                                                                                                                                 | Consequence                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Engine           | `CreateDBInstance` starts a real `postgres:16-alpine` container (PostgreSQL 16.15) through the mounted Docker socket. Status is `available` after ~1.5 s.   | Real Postgres behaviour, including `EXPLAIN ANALYZE`.                                                   |
| Networking       | Floci runs an auth proxy per instance on ports `7001+` inside the Floci container, assigned in creation order.                                              | Ports `7001-7005` are published on `127.0.0.1`.                                                         |
| Endpoint address | `DescribeDBInstances` reports the Floci container IP (e.g. `172.23.0.2:7001`), which is not reachable from the host. `FLOCI_HOSTNAME` does not change this. | The app takes `DATABASE_URL` from configuration; bootstrap only checks that the port matches.           |
| TLS              | The proxy generates a CA at `/app/data/tls/rds-ca.crt` inside the container.                                                                                | Not used locally; connections use plain TCP on `127.0.0.1`.                                             |
| Cleanup          | `docker compose down` removes the Postgres container. `docker rm -f floci` leaves it orphaned (`floci-aws-rds-db-*`).                                       | Always stop with `pnpm env:down`. Orphans: `docker rm -f $(docker ps -aq --filter name=floci-aws-rds)`. |
