# ADR 0005: Presigned POST instead of upload through the API

- Status: accepted
- Date: 2026-10-18

## Context

Defect reports can carry a photo or PDF of up to 10 MB. The files must be validated for type and size, and large uploads should not occupy API processes or memory.

## Options

1. **Upload through the API.** The API receives the multipart request, validates it and writes to S3. Simple client flow, but every byte passes through the API, and size limits depend on proxy and framework settings.
2. **Presigned PUT URL.** The client uploads directly to S3. The signature can bind the content type, but S3 cannot limit the object size.
3. **Presigned POST.** The client uploads directly to S3 with a signed policy. The policy fixes the object key, the content type and a `content-length-range`; S3 rejects anything else.

## Decision

Option 3. `POST /defects` validates the declared file name, type (JPEG, PNG, PDF) and size (1 byte to 10 MB), then returns a presigned POST. The policy pins the key (`defects/<defect id>`), the content type, and the size to exactly the declared value. The URL expires after 5 minutes.

The declaration is also verified after the upload (see [ADR 0006](0006-explicit-upload-confirmation.md)), because the content type in a policy is whatever the client sends, not a sniffed file type.

## Consequences

- The API never handles file content; memory use and request duration are independent of file size.
- The browser needs CORS access to the bucket. The bucket allows `POST` from the web origin only.
- The client needs one more request than with a direct upload (create, upload, confirm).
- Content is not scanned or sniffed. A file declared as PNG may contain other data. Downloads are served with `Content-Disposition: attachment`, so browsers do not render them inline.

## When to revisit

- With files above 5 GB or flaky mobile connections, multipart upload with resumable parts would replace the single POST.
- If a defect could have several attachments or a repeated upload, the key would get a random suffix so that a new upload cannot overwrite a confirmed object.
- If uploads had to be scanned for malware, an S3-event-driven scan step with a quarantine prefix would be added before attachments become visible.
- If files were tiny and always below the API's body limit, uploading through the API would be simpler and equally safe.
