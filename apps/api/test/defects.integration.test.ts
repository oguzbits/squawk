import { randomUUID } from 'node:crypto';
import {
  createDefectResponseSchema,
  defectListSchema,
  defectSchema,
  type CreateDefectResponse,
} from '@squawk/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPool } from '../src/db.ts';
import { createS3Client, createStorage } from '../src/storage.ts';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const storage = createStorage(createS3Client(), config.S3_BUCKET);
const registration = `U-${Date.now().toString(36).toUpperCase()}`;
const createdKeys: string[] = [];
let app: FastifyInstance;
let aircraftId: string;

beforeAll(async () => {
  app = await buildApp({ pool, storage, logLevel: 'silent' });
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO aircraft (registration, model, msn) VALUES ($1, 'A320-214', '1') RETURNING id",
    [registration],
  );
  aircraftId = rows[0]!.id;
});

afterAll(async () => {
  await pool.query('DELETE FROM defect WHERE aircraft_id = $1', [aircraftId]);
  await pool.query('DELETE FROM aircraft WHERE id = $1', [aircraftId]);
  await Promise.all(createdKeys.map((key) => storage.deleteObject(key)));
  await app.close();
  await pool.end();
});

async function createDefect(body: unknown) {
  const res = await app.inject({ method: 'POST', url: '/defects', payload: body as object });
  return res;
}

async function createWithAttachment(size: number, contentType = 'image/png') {
  const res = await createDefect({
    aircraftId,
    title: 'Cracked windscreen',
    attachment: { fileName: 'crack.png', contentType, size },
  });
  expect(res.statusCode).toBe(201);
  const body: CreateDefectResponse = createDefectResponseSchema.parse(res.json());
  expect(body.upload).not.toBeNull();
  const { rows } = await pool.query<{ attachment_key: string }>(
    'SELECT attachment_key FROM defect WHERE id = $1',
    [body.defect.id],
  );
  createdKeys.push(rows[0]!.attachment_key);
  return body;
}

// Sends the file the way a browser does: multipart form to the presigned URL.
async function upload(target: NonNullable<CreateDefectResponse['upload']>, bytes: Uint8Array) {
  const form = new FormData();
  for (const [name, value] of Object.entries(target.fields)) form.append(name, value);
  form.append('file', new Blob([bytes]));
  return fetch(target.url, { method: 'POST', body: form });
}

const complete = (id: string) =>
  app.inject({ method: 'POST', url: `/defects/${id}/attachment/complete` });

describe('creating a defect', () => {
  it('stores a defect without attachment and offers no upload target', async () => {
    const res = await createDefect({ aircraftId, title: '  Seat belt frayed  ' });

    expect(res.statusCode).toBe(201);
    const body = createDefectResponseSchema.parse(res.json());
    expect(body.upload).toBeNull();
    expect(body.defect).toMatchObject({
      aircraftRegistration: registration,
      title: 'Seat belt frayed',
      description: '',
      status: 'open',
      attachment: null,
    });
  });

  it.each([
    ['a title that is too short', { title: 'ab' }],
    [
      'an unsupported content type',
      { attachment: { fileName: 'x.exe', contentType: 'application/x-msdownload', size: 10 } },
    ],
    [
      'an attachment above the size limit',
      {
        attachment: {
          fileName: 'x.pdf',
          contentType: 'application/pdf',
          size: 10 * 1024 * 1024 + 1,
        },
      },
    ],
    [
      'an empty attachment',
      { attachment: { fileName: 'x.pdf', contentType: 'application/pdf', size: 0 } },
    ],
  ])('rejects %s with 400', async (_name, override) => {
    const res = await createDefect({ aircraftId, title: 'Valid title', ...override });
    expect(res.statusCode).toBe(400);
  });

  it('answers 404 for an unknown aircraft', async () => {
    const res = await createDefect({ aircraftId: randomUUID(), title: 'Valid title' });
    expect(res.statusCode).toBe(404);
  });
});

describe('attachment upload via presigned POST', () => {
  it('accepts a file that matches the declaration and exposes it after completion', async () => {
    const bytes = new Uint8Array(2048).fill(7);
    const { defect, upload: target } = await createWithAttachment(bytes.length);
    expect(defect.attachment).toBeNull();

    expect((await upload(target!, bytes)).status).toBe(204);
    const done = await complete(defect.id);

    expect(done.statusCode).toBe(200);
    const confirmed = defectSchema.parse(done.json());
    expect(confirmed.attachment).toMatchObject({
      fileName: 'crack.png',
      contentType: 'image/png',
      size: 2048,
    });

    const download = await fetch(confirmed.attachment!.downloadUrl);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toBe('attachment; filename="crack.png"');
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
  });

  it('is rejected by S3 when the file is larger than declared', async () => {
    const { upload: target } = await createWithAttachment(100);
    expect((await upload(target!, new Uint8Array(101))).status).toBe(400);
  });

  it('is rejected by S3 when the file is smaller than declared', async () => {
    const { upload: target } = await createWithAttachment(100);
    expect((await upload(target!, new Uint8Array(99))).status).toBe(400);
  });

  it('is rejected by S3 when the content type differs from the declaration', async () => {
    const { upload: target } = await createWithAttachment(100);
    const tampered = { ...target!, fields: { ...target!.fields, 'Content-Type': 'text/html' } };
    expect((await upload(tampered, new Uint8Array(100))).status).toBe(403);
  });

  it('is rejected by S3 when the object key is changed', async () => {
    const { upload: target } = await createWithAttachment(100);
    const tampered = { ...target!, fields: { ...target!.fields, key: 'defects/other/file' } };
    expect((await upload(tampered, new Uint8Array(100))).status).toBe(403);
  });
});

describe('completing an upload', () => {
  it('answers 422 when nothing was uploaded', async () => {
    const { defect } = await createWithAttachment(100);
    expect((await complete(defect.id)).statusCode).toBe(422);
  });

  it('is idempotent', async () => {
    const { defect, upload: target } = await createWithAttachment(10);
    await upload(target!, new Uint8Array(10));

    const first = await complete(defect.id);
    const second = await complete(defect.id);

    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    expect(defectSchema.parse(second.json()).attachment).not.toBeNull();
  });

  it('rejects and removes an object that does not match the declaration', async () => {
    const { defect } = await createWithAttachment(10);
    const { rows } = await pool.query<{ attachment_key: string }>(
      'SELECT attachment_key FROM defect WHERE id = $1',
      [defect.id],
    );
    const key = rows[0]!.attachment_key;
    // Bypasses the presigned policy to simulate an object that slipped past it.
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await createS3Client().send(
      new PutObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: key,
        Body: new Uint8Array(11),
        ContentType: 'image/png',
      }),
    );

    const res = await complete(defect.id);

    expect(res.statusCode).toBe(422);
    expect(await storage.statObject(key)).toBeNull();
  });

  it('answers 409 for a defect without attachment and 404 for an unknown defect', async () => {
    const plain = createDefectResponseSchema.parse(
      (await createDefect({ aircraftId, title: 'No file' })).json(),
    );

    expect((await complete(plain.defect.id)).statusCode).toBe(409);
    expect((await complete(randomUUID())).statusCode).toBe(404);
  });
});

describe('listing defects', () => {
  it('lists newest first and filters by aircraft', async () => {
    await createDefect({ aircraftId, title: 'First defect' });
    await createDefect({ aircraftId, title: 'Second defect' });

    const res = await app.inject({ url: `/defects?aircraftId=${aircraftId}` });

    expect(res.statusCode).toBe(200);
    const list = defectListSchema.parse(res.json());
    expect(list.every((d) => d.aircraftId === aircraftId)).toBe(true);
    const titles = list.map((d) => d.title);
    expect(titles.indexOf('Second defect')).toBeLessThan(titles.indexOf('First defect'));
  });

  it('only shows attachments whose upload was confirmed', async () => {
    const { defect } = await createWithAttachment(10);

    const list = defectListSchema.parse(
      (await app.inject({ url: `/defects?aircraftId=${aircraftId}` })).json(),
    );

    expect(list.find((d) => d.id === defect.id)?.attachment).toBeNull();
  });

  it('rejects a malformed aircraft filter with 400', async () => {
    expect((await app.inject({ url: '/defects?aircraftId=nope' })).statusCode).toBe(400);
  });
});
