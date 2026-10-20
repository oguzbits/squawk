# ADR 0007: Flight data import through S3, SQS and Lambda

- Status: accepted
- Date: 2026-10-20

## Context

Flight logs arrive as CSV files, one row per flight (`registration, flight_date, block_off, block_on, landings, cycles`). Importing them must not block an HTTP request, must survive retries and re-uploads of overlapping files, and must not lose a file that cannot be processed.

## Options

1. **Import inside the API request.** Simple, but long requests, no retry and no isolation of a bad file.
2. **Worker process next to the API** polling a queue. Retries and dead-lettering would be our own code.
3. **S3 → SQS → Lambda.** The upload triggers a notification, SQS buffers it and redelivers on failure, a dead-letter queue collects files that keep failing.

Idempotency options: a hash of the file (misses corrected or overlapping exports) or a natural key per row.

## Decision

Option 3. The client creates an import with `POST /imports` and uploads the file with a presigned POST (as in [ADR 0005](0005-presigned-post-instead-of-upload-through-api.md)) to `imports/<importId>.csv`. S3 notifies the queue `flight-import-files`; one Lambda per message reads the file, validates every row, writes valid rows and records the result on the import (`imported`, `skipped`, `rejected`, status, first rejected line numbers with a reason, never row content).

Flights are unique on `(aircraft_id, block_off)`. Rows are written with `INSERT … ON CONFLICT DO NOTHING`, so a retried message or a re-uploaded file imports nothing twice. The queue has a dead-letter queue with `maxReceiveCount: 3`.

Row validation and CSV parsing are pure functions in `apps/importer`, which is bundled into the Lambda. Invalid rows are rejected and counted; they do not fail the file. Only a file-level failure (unreadable, over the size limit, database down) throws, which triggers a retry and eventually the DLQ.

## Consequences

- Retries and dead-lettering belong to the platform. Import progress is visible through the import record.
- The Lambda holds the whole file in memory. Limit: 5 MB, enforced by the upload policy; larger files would need streaming or fan-out of rows to a second queue.
- Duplicate detection is per `(aircraft_id, block_off)`. A corrected row with the same block-off time is skipped, not updated.
- An import whose file is never uploaded stays `pending`.
- Tests need Floci with Lambda; the first run pulls the runtime image.

## When to revisit

- Files above the size limit: split into row batches on a second queue.
- Corrections of existing flights: change `DO NOTHING` to an update with an audit entry.
- Strict ordering or exactly-once processing: FIFO queue with deduplication.
