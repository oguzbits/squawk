import { z } from 'zod';

export const aircraftSchema = z.object({
  id: z.uuid(),
  registration: z.string(),
  model: z.string(),
  msn: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
});

export const aircraftListSchema = z.array(aircraftSchema);

export type Aircraft = z.infer<typeof aircraftSchema>;
