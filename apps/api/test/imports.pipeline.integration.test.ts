import {
  CreateEventSourceMappingCommand,
  DeleteEventSourceMappingCommand,
  LambdaClient,
} from '@aws-sdk/client-lambda';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SQSClient,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { createImportResponseSchema, flightImportSchema } from '@squawk/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPool } from '../src/db.ts';
import { createS3Client, createStorage } from '../src/storage.ts';

// Needs the pipeline from `pnpm env:up`: S3 notification, queue and the importer Lambda.
const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const storage = createStorage(createS3Client(), config.S3_BUCKET);
const registration = `P-${Date.now().toString(36).toUpperCase()}`.slice(0, 7);
const importIds: string[] = [];
let app: FastifyInstance;
let aircraftId: string;

beforeAll(async () => {
  app = await buildApp({ pool, storage, logLevel: 'silent' });
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO aircraft (registration, model, msn) VALUES ($1, 'A320-214', '1') RETURNING id",
    [registration],
  );
  aircraftId = rows[0]?.id ?? '';
});

afterAll(async () => {
  await pool.query('DELETE FROM flight WHERE aircraft_id = $1', [aircraftId]);
  await pool.query('DELETE FROM flight_import WHERE id = ANY($1)', [importIds]);
  await pool.query('DELETE FROM aircraft WHERE id = $1', [aircraftId]);
  await Promise.all(importIds.map((id) => storage.deleteObject(`imports/${id}.csv`)));
  await app.close();
  await pool.end();
});

async function uploadCsv(csv: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/imports',
    payload: { fileName: 'flights.csv', size: Buffer.byteLength(csv) },
  });
  const { import: created, upload } = createImportResponseSchema.parse(res.json());
  importIds.push(created.id);
  const form = new FormData();
  for (const [name, value] of Object.entries(upload.fields)) form.append(name, value);
  form.append('file', new Blob([csv]));
  expect((await fetch(upload.url, { method: 'POST', body: form })).status).toBe(204);
  return created.id;
}

async function waitForResult(id: string) {
  // The first invocation pulls the Lambda runtime image, so allow a generous deadline.
  const deadline = Date.now() + 90_000;
  for (;;) {
    const res = await app.inject({ method: 'GET', url: `/imports/${id}` });
    const result = flightImportSchema.parse(res.json());
    if (result.status !== 'pending' || Date.now() > deadline) return result;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const HEADER = 'registration,flight_date,block_off,block_on,landings,cycles';

describe('flight import pipeline', () => {
  it('imports an uploaded file through S3, SQS and Lambda, and skips it when uploaded again', async () => {
    const csv = `${HEADER}\n${registration},2026-10-05,2026-10-05T08:00:00Z,2026-10-05T09:00:00Z,1,1\nbroken\n`;
    const first = await waitForResult(await uploadCsv(csv));
    expect(first).toMatchObject({ status: 'completed', imported: 1, skipped: 0, rejected: 1 });
    expect(first.rejections).toEqual([{ line: 3, reason: 'expected 6 fields' }]);

    const second = await waitForResult(await uploadCsv(csv));
    expect(second).toMatchObject({ status: 'completed', imported: 0, skipped: 1 });
    const { rows } = await pool.query('SELECT 1 FROM flight WHERE aircraft_id = $1', [aircraftId]);
    expect(rows).toHaveLength(1);
  }, 120_000);
});

describe('dead-letter queue', () => {
  it('moves a message the Lambda cannot process to the DLQ after the maximum receives', async () => {
    const sqs = new SQSClient({});
    const lambda = new LambdaClient({});
    const suffix = Date.now().toString(36);
    const dlq = await sqs.send(new CreateQueueCommand({ QueueName: `test-dlq-${suffix}` }));
    const { Attributes } = await sqs.send(
      new GetQueueAttributesCommand({ QueueUrl: dlq.QueueUrl, AttributeNames: ['QueueArn'] }),
    );
    const queue = await sqs.send(
      new CreateQueueCommand({
        QueueName: `test-queue-${suffix}`,
        Attributes: {
          VisibilityTimeout: '3',
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: Attributes?.QueueArn,
            maxReceiveCount: 2,
          }),
        },
      }),
    );
    const { Attributes: queueAttributes } = await sqs.send(
      new GetQueueAttributesCommand({ QueueUrl: queue.QueueUrl, AttributeNames: ['QueueArn'] }),
    );
    // A Floci mapping outlives deleted queues and functions, so it is removed explicitly.
    const mapping = await lambda.send(
      new CreateEventSourceMappingCommand({
        FunctionName: 'squawk-flight-import',
        EventSourceArn: queueAttributes?.QueueArn,
        BatchSize: 1,
      }),
    );
    try {
      await sqs.send(new SendMessageCommand({ QueueUrl: queue.QueueUrl, MessageBody: 'not json' }));
      const deadline = Date.now() + 90_000;
      let dead: string | undefined;
      while (!dead && Date.now() < deadline) {
        const res = await sqs.send(
          new ReceiveMessageCommand({ QueueUrl: dlq.QueueUrl, WaitTimeSeconds: 2 }),
        );
        dead = res.Messages?.[0]?.Body;
      }
      expect(dead).toBe('not json');
    } finally {
      await lambda.send(new DeleteEventSourceMappingCommand({ UUID: mapping.UUID }));
      await sqs.send(new DeleteQueueCommand({ QueueUrl: queue.QueueUrl }));
      await sqs.send(new DeleteQueueCommand({ QueueUrl: dlq.QueueUrl }));
    }
  }, 120_000);
});
