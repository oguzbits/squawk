# ADR 0006: Explicit upload confirmation instead of S3 events

- Status: accepted
- Date: 2026-10-18

## Context

After a direct upload to S3, the API must learn that the object exists before it shows the attachment. Until then the defect has an attachment record that points to nothing.

## Options

1. **S3 event notification** (to SQS or Lambda) marks the attachment as uploaded. No extra client call, but it needs a queue or function in this milestone, and the client cannot tell when the attachment is ready.
2. **Explicit confirmation.** After the upload the client calls `POST /defects/:id/attachment/complete`. The API reads the object metadata (`HeadObject`), compares size and content type with the declaration and only then marks the attachment as uploaded.

## Decision

Option 2. The call is idempotent: repeating it for a confirmed attachment returns the defect unchanged. If the stored object differs from the declaration, the object is deleted and the call fails with 422. Attachments that were never confirmed are not shown.

## Consequences

- No additional AWS resources are needed for this feature.
- The client controls the sequence and can report a failed upload to the user while the defect itself stays saved.
- Abandoned uploads leave a defect with an unconfirmed attachment and possibly an orphaned object. A lifecycle rule or cleanup job is not part of this milestone.
- A client that never calls `complete` leaves a valid upload invisible.

## When to revisit

- If uploads came from clients that cannot be trusted to call back (devices, other systems), S3 events would confirm uploads server-side.
- If orphaned objects became a cost or compliance problem, an event-driven cleanup or an S3 lifecycle rule would be added.
