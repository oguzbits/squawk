import { aircraftListSchema, type Aircraft } from '@squawk/shared';
import type { z } from 'zod';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new ApiError(res.status, `GET ${path} failed with status ${res.status}`);
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) throw new Error(`GET ${path} returned an unexpected response`);
  return parsed.data;
}

export const fetchAircraft = (): Promise<Aircraft[]> => getJson('/aircraft', aircraftListSchema);
