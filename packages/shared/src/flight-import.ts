import { z } from 'zod';
import { uploadTargetSchema } from './defect.ts';

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_REJECTIONS = 20;

export const createImportInputSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  size: z.number().int().min(1).max(IMPORT_MAX_BYTES),
});

export const importStatusSchema = z.enum(['pending', 'completed', 'failed']);

export const flightImportSchema = z.object({
  id: z.uuid(),
  fileName: z.string(),
  status: importStatusSchema,
  imported: z.number().int(),
  skipped: z.number().int(),
  rejected: z.number().int(),
  rejections: z.array(z.object({ line: z.number().int(), reason: z.string() })),
  createdAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
});

export const createImportResponseSchema = z.object({
  import: flightImportSchema,
  upload: uploadTargetSchema,
});

export type CreateImportInput = z.input<typeof createImportInputSchema>;
export type FlightImport = z.infer<typeof flightImportSchema>;
export type CreateImportResponse = z.infer<typeof createImportResponseSchema>;
