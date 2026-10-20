import { randomUUID } from 'node:crypto';
import {
  createImportInputSchema,
  createImportResponseSchema,
  flightImportSchema,
  type FlightImport,
} from '@squawk/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { z } from 'zod';
import type { Storage } from '../storage.ts';
import { errorSchema, problem } from './errors.ts';

interface ImportRow {
  id: string;
  file_name: string;
  status: FlightImport['status'];
  imported: number;
  skipped: number;
  rejected: number;
  rejections: FlightImport['rejections'];
  created_at: Date;
  completed_at: Date | null;
}

const SELECT_IMPORT = `
  SELECT id, file_name, status, imported, skipped, rejected, rejections, created_at, completed_at
  FROM flight_import`;

const toImport = (row: ImportRow): FlightImport => ({
  id: row.id,
  fileName: row.file_name,
  status: row.status,
  imported: row.imported,
  skipped: row.skipped,
  rejected: row.rejected,
  rejections: row.rejections,
  createdAt: row.created_at.toISOString(),
  completedAt: row.completed_at?.toISOString() ?? null,
});

// The key is the contract with the importer Lambda and the bucket notification filter.
export const importKey = (id: string) => `imports/${id}.csv`;

export const importRoutes: FastifyPluginAsyncZod<{ pool: pg.Pool; storage: Storage }> = async (
  app,
  { pool, storage },
) => {
  app.post(
    '/imports',
    { schema: { body: createImportInputSchema, response: { 201: createImportResponseSchema } } },
    async (req, reply) => {
      const { fileName, size } = req.body;
      const id = randomUUID();
      const { rows } = await pool.query<ImportRow>(
        `INSERT INTO flight_import (id, file_name, size) VALUES ($1, $2, $3)
         RETURNING id, file_name, status, imported, skipped, rejected, rejections, created_at, completed_at`,
        [id, fileName, size],
      );
      const row = rows[0];
      if (!row) throw new Error(`import ${id} missing after insert`);
      const upload = await storage.createUpload(importKey(id), 'text/csv', size);
      return reply.code(201).send({ import: toImport(row), upload });
    },
  );

  app.get(
    '/imports/:id',
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        response: { 200: flightImportSchema, 404: errorSchema },
      },
    },
    async (req, reply) => {
      const { rows } = await pool.query<ImportRow>(`${SELECT_IMPORT} WHERE id = $1`, [
        req.params.id,
      ]);
      const row = rows[0];
      return row ? toImport(row) : problem(reply, 404, 'Import not found');
    },
  );
};
