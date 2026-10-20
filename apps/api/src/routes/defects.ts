import { randomUUID } from 'node:crypto';
import {
  ATTACHMENT_TYPES,
  createDefectInputSchema,
  createDefectResponseSchema,
  defectListSchema,
  defectSchema,
  type Defect,
} from '@squawk/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { z } from 'zod';
import type { Storage } from '../storage.ts';
import { errorSchema, problem } from './errors.ts';

interface DefectRow {
  id: string;
  aircraft_id: string;
  aircraft_registration: string;
  title: string;
  description: string;
  status: Defect['status'];
  created_at: Date;
  attachment_key: string | null;
  attachment_file_name: string | null;
  attachment_content_type: (typeof ATTACHMENT_TYPES)[number] | null;
  attachment_size: string | null;
  attachment_uploaded_at: Date | null;
}

const SELECT_DEFECT = `
  SELECT d.id, d.aircraft_id, a.registration AS aircraft_registration, d.title, d.description,
         d.status, d.created_at, d.attachment_key, d.attachment_file_name,
         d.attachment_content_type, d.attachment_size, d.attachment_uploaded_at
  FROM defect d
  JOIN aircraft a ON a.id = d.aircraft_id`;

const FOREIGN_KEY_VIOLATION = '23503';

export const defectRoutes: FastifyPluginAsyncZod<{ pool: pg.Pool; storage: Storage }> = async (
  app,
  { pool, storage },
) => {
  // An attachment is only exposed once the upload has been confirmed.
  async function toDefect(row: DefectRow): Promise<Defect> {
    const key = row.attachment_key;
    const fileName = row.attachment_file_name;
    const contentType = row.attachment_content_type;
    const confirmed = row.attachment_uploaded_at !== null && row.attachment_size !== null;
    return {
      id: row.id,
      aircraftId: row.aircraft_id,
      aircraftRegistration: row.aircraft_registration,
      title: row.title,
      description: row.description,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      attachment:
        confirmed && key && fileName && contentType
          ? {
              fileName,
              contentType,
              size: Number(row.attachment_size),
              downloadUrl: await storage.downloadUrl(key, fileName),
            }
          : null,
    };
  }

  const findDefect = async (id: string): Promise<DefectRow | undefined> =>
    (await pool.query<DefectRow>(`${SELECT_DEFECT} WHERE d.id = $1`, [id])).rows[0];

  app.get(
    '/defects',
    {
      schema: {
        querystring: z.object({ aircraftId: z.uuid().optional() }),
        response: { 200: defectListSchema },
      },
    },
    async (req) => {
      const { rows } = await pool.query<DefectRow>(
        `${SELECT_DEFECT} WHERE ($1::uuid IS NULL OR d.aircraft_id = $1) ORDER BY d.created_at DESC`,
        [req.query.aircraftId ?? null],
      );
      return Promise.all(rows.map(toDefect));
    },
  );

  app.post(
    '/defects',
    {
      schema: {
        body: createDefectInputSchema,
        response: { 201: createDefectResponseSchema, 404: errorSchema },
      },
    },
    async (req, reply) => {
      const { aircraftId, title, description, attachment } = req.body;
      const id = randomUUID();
      const key = attachment ? `defects/${id}` : null;

      try {
        await pool.query(
          `INSERT INTO defect (id, aircraft_id, title, description, attachment_key,
                               attachment_file_name, attachment_content_type, attachment_size)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            aircraftId,
            title,
            description,
            key,
            attachment?.fileName ?? null,
            attachment?.contentType ?? null,
            attachment?.size ?? null,
          ],
        );
      } catch (err) {
        if ((err as { code?: string }).code === FOREIGN_KEY_VIOLATION) {
          return problem(reply, 404, 'Aircraft not found');
        }
        throw err;
      }

      const row = await findDefect(id);
      if (!row) throw new Error(`defect ${id} missing after insert`);
      const upload =
        attachment && key
          ? await storage.createUpload(key, attachment.contentType, attachment.size)
          : null;
      return reply.code(201).send({ defect: await toDefect(row), upload });
    },
  );

  app.post(
    '/defects/:id/attachment/complete',
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        response: { 200: defectSchema, 404: errorSchema, 409: errorSchema, 422: errorSchema },
      },
    },
    async (req, reply) => {
      const row = await findDefect(req.params.id);
      if (!row) return problem(reply, 404, 'Defect not found');
      if (!row.attachment_key) return problem(reply, 409, 'Defect has no attachment');
      // Repeating the call is harmless, so clients can retry after a network error.
      if (row.attachment_uploaded_at) return toDefect(row);

      const stored = await storage.statObject(row.attachment_key);
      if (!stored) return problem(reply, 422, 'Attachment has not been uploaded');
      if (
        stored.size !== Number(row.attachment_size) ||
        stored.contentType !== row.attachment_content_type
      ) {
        await storage.deleteObject(row.attachment_key);
        return problem(reply, 422, 'Uploaded file does not match the declared size or type');
      }

      const { rows } = await pool.query<{ attachment_uploaded_at: Date }>(
        `UPDATE defect SET attachment_uploaded_at = now()
         WHERE id = $1 AND attachment_uploaded_at IS NULL
         RETURNING attachment_uploaded_at`,
        [row.id],
      );
      const confirmedAt = rows[0]?.attachment_uploaded_at ?? new Date();
      return toDefect({ ...row, attachment_uploaded_at: confirmedAt });
    },
  );
};
