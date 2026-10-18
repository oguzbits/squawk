import { z } from 'zod';

export const ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

const attachmentTypeSchema = z.enum(ATTACHMENT_TYPES);

export const defectStatusSchema = z.enum(['open', 'resolved']);

export const attachmentInputSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: attachmentTypeSchema,
  size: z.number().int().min(1).max(ATTACHMENT_MAX_BYTES),
});

export const createDefectInputSchema = z.object({
  aircraftId: z.uuid(),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000).default(''),
  attachment: attachmentInputSchema.optional(),
});

export const attachmentSchema = z.object({
  fileName: z.string(),
  contentType: attachmentTypeSchema,
  size: z.number().int(),
  downloadUrl: z.url(),
});

export const defectSchema = z.object({
  id: z.uuid(),
  aircraftId: z.uuid(),
  aircraftRegistration: z.string(),
  title: z.string(),
  description: z.string(),
  status: defectStatusSchema,
  attachment: attachmentSchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});

export const defectListSchema = z.array(defectSchema);

export const uploadTargetSchema = z.object({
  url: z.url(),
  fields: z.record(z.string(), z.string()),
});

export const createDefectResponseSchema = z.object({
  defect: defectSchema,
  upload: uploadTargetSchema.nullable(),
});

export type CreateDefectInput = z.input<typeof createDefectInputSchema>;
export type Defect = z.infer<typeof defectSchema>;
export type UploadTarget = z.infer<typeof uploadTargetSchema>;
export type CreateDefectResponse = z.infer<typeof createDefectResponseSchema>;
