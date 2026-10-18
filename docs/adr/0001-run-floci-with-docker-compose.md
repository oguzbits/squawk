# ADR 0001: Run Floci with Docker Compose

- Status: accepted
- Date: 2026-10-18

## Context

All AWS services run locally in Floci. The local environment must start reproducibly with one command, on developer machines and later in CI. Floci emulates RDS and ElastiCache with real database containers that are reached through proxy ports on the Floci container (RDS: `7001-7099`, ElastiCache: `6379-6399`). These ports must be published to the host.

## Options

1. **`floci start`** (CLI). Simple, but publishes only port 4566 and has no option for extra port mappings. RDS would not be reachable from the host.
2. **`docker run` in a shell script.** Works, but duplicates what Compose already does (naming, ports, lifecycle) and is harder to read.
3. **`docker-compose.yml`.** Declarative, version-pinned image, explicit port list. `floci config validate` exists to check such files.

## Decision

Option 3. `docker-compose.yml` defines a single `floci` service with the image pinned to `2.3.0`, port 4566 and only the proxy ports the project uses, all bound to `127.0.0.1`. The container is named `floci`, so `floci doctor`, `floci status` and `floci env` keep working.

## Consequences

- `pnpm env:up` / `pnpm env:down` wrap `docker compose up -d` / `docker compose down`.
- New services that need proxy ports (ElastiCache) add their range to the compose file.
- Floci upgrades are explicit changes to the image tag.

## When to revisit

- If the Floci CLI gains port mapping or profile support for it, `floci start` with a checked-in profile would remove the compose file.
- If the project needed more local services than Floci (for example a mail catcher), Compose would stay and grow; nothing to change.
