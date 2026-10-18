import { aircraftListSchema, type Aircraft } from '@squawk/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type pg from 'pg';

interface AircraftRow {
  id: string;
  registration: string;
  model: string;
  msn: string;
  created_at: Date;
}

const toAircraft = (row: AircraftRow): Aircraft => ({
  id: row.id,
  registration: row.registration,
  model: row.model,
  msn: row.msn,
  createdAt: row.created_at.toISOString(),
});

export const aircraftRoutes: FastifyPluginAsyncZod<{ pool: pg.Pool }> = async (app, { pool }) => {
  app.get('/aircraft', { schema: { response: { 200: aircraftListSchema } } }, async () => {
    const { rows } = await pool.query<AircraftRow>(
      'SELECT id, registration, model, msn, created_at FROM aircraft ORDER BY registration',
    );
    return rows.map(toAircraft);
  });
};
