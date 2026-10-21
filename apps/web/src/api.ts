import {
  aircraftListSchema,
  createDefectResponseSchema,
  completeTaskResponseSchema,
  createImportResponseSchema,
  defectListSchema,
  defectSchema,
  dueDashboardSchema,
  flightImportSchema,
  type Aircraft,
  type CreateDefectInput,
  type Defect,
  type DueDashboard,
  type FlightImport,
  type UploadTarget,
} from '@squawk/shared';
import type { z } from 'zod';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (typeof body === 'object' && body !== null && 'message' in body) {
      if (typeof body.message === 'string') return body.message;
    }
  } catch {
    // not JSON
  }
  return fallback;
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new ApiError(
      res.status,
      await errorMessage(res, `${method} ${path} failed with status ${res.status}`),
    );
  }
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) throw new Error(`${method} ${path} returned an unexpected response`);
  return parsed.data;
}

export const fetchAircraft = (): Promise<Aircraft[]> =>
  request('GET', '/aircraft', aircraftListSchema);

export const fetchDefects = (): Promise<Defect[]> => request('GET', '/defects', defectListSchema);

async function uploadToStorage(target: UploadTarget, file: File): Promise<void> {
  // Goes straight to S3; the file never passes through the API.
  const form = new FormData();
  for (const [name, value] of Object.entries(target.fields)) form.append(name, value);
  form.append('file', file);
  const res = await fetch(target.url, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Upload to storage failed with status ${res.status}`);
}

export interface ReportResult {
  defect: Defect;
  /** Set when the defect was saved but the attachment could not be stored. */
  attachmentError: string | null;
}

export async function reportDefect(
  input: CreateDefectInput,
  file: File | undefined,
): Promise<ReportResult> {
  const { defect, upload } = await request('POST', '/defects', createDefectResponseSchema, input);
  if (!upload || !file) return { defect, attachmentError: null };

  try {
    await uploadToStorage(upload, file);
    const confirmed = await request(
      'POST',
      `/defects/${defect.id}/attachment/complete`,
      defectSchema,
    );
    return { defect: confirmed, attachmentError: null };
  } catch (err) {
    return {
      defect,
      attachmentError: err instanceof Error ? err.message : 'Attachment upload failed',
    };
  }
}

export const fetchImport = (id: string): Promise<FlightImport> =>
  request('GET', `/imports/${id}`, flightImportSchema);

/** Creates the import and uploads the file; the pipeline processes it asynchronously. */
export async function startImport(file: File): Promise<FlightImport> {
  const { import: created, upload } = await request(
    'POST',
    '/imports',
    createImportResponseSchema,
    {
      fileName: file.name,
      size: file.size,
    },
  );
  await uploadToStorage(upload, file);
  return created;
}

export const fetchDueDashboard = (): Promise<DueDashboard> =>
  request('GET', '/dashboard/due', dueDashboardSchema);

export const completeTask = (taskId: string) =>
  request('POST', `/maintenance-tasks/${taskId}/complete`, completeTaskResponseSchema);
