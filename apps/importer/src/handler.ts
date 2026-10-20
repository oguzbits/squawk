import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import pg from 'pg';
import { processImport } from './process.ts';

interface SqsEvent {
  Records: { messageId: string; body: string }[];
}

const KEY = /^imports\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.csv$/;

// Created once per container and reused by later invocations.
const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 });
const s3 = new S3Client({ forcePathStyle: Boolean(process.env['AWS_ENDPOINT_URL']) });

const log = (fields: Record<string, unknown>) =>
  process.stdout.write(`${JSON.stringify(fields)}\n`);

async function readObject(bucket: string, key: string): Promise<string> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!res.Body) throw new Error('empty object body');
  return res.Body.transformToString('utf-8');
}

// Any thrown error leaves the message on the queue: it is retried and finally dead-lettered.
export async function handler(event: SqsEvent): Promise<void> {
  for (const record of event.Records) {
    const body: unknown = JSON.parse(record.body);
    // S3 first sends an s3:TestEvent without Records when the notification is configured.
    const s3Records = (
      body as { Records?: { s3: { bucket: { name: string }; object: { key: string } } }[] }
    ).Records;
    if (!s3Records) {
      log({ level: 'info', msg: 'ignored message without records', messageId: record.messageId });
      continue;
    }
    for (const { s3: entry } of s3Records) {
      const key = decodeURIComponent(entry.object.key.replace(/\+/g, ' '));
      const match = KEY.exec(key);
      if (!match?.[1]) {
        log({
          level: 'warn',
          msg: 'ignored object outside the import key pattern',
          messageId: record.messageId,
        });
        continue;
      }
      const importId = match[1];
      const outcome = await processImport(
        { pool, readObject: (k) => readObject(entry.bucket.name, k) },
        importId,
      );
      log({
        level: 'info',
        msg: 'import processed',
        correlationId: importId,
        messageId: record.messageId,
        outcome,
      });
    }
  }
}
