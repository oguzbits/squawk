import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TYPES,
  createDefectInputSchema,
  type CreateDefectInput,
} from '@squawk/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { fetchAircraft, reportDefect } from './api.ts';

type Field = 'aircraftId' | 'title' | 'description' | 'attachment';

const FIELD_MESSAGES: Record<Field, string> = {
  aircraftId: 'Select an aircraft.',
  title: 'Enter a title of 3 to 120 characters.',
  description: 'The description may have at most 2000 characters.',
  attachment: `Attach a JPEG, PNG or PDF of up to ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB.`,
};

export function DefectForm() {
  const queryClient = useQueryClient();
  const aircraft = useQuery({ queryKey: ['aircraft'], queryFn: fetchAircraft });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formKey, setFormKey] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const report = useMutation({
    mutationFn: ({ input, file }: { input: CreateDefectInput; file: File | undefined }) =>
      reportDefect(input, file),
    onSuccess: () => {
      setFormKey((key) => key + 1);
      return queryClient.invalidateQueries({ queryKey: ['defects'] });
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    report.reset();
    const data = new FormData(event.currentTarget);
    const file = fileInput.current?.files?.[0];
    const attachment = file && file.size > 0 ? file : undefined;

    const raw = {
      aircraftId: String(data.get('aircraftId') ?? ''),
      title: String(data.get('title') ?? ''),
      description: String(data.get('description') ?? ''),
      ...(attachment && {
        attachment: {
          fileName: attachment.name,
          contentType: attachment.type,
          size: attachment.size,
        },
      }),
    };

    const parsed = createDefectInputSchema.safeParse(raw);
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as Field;
        next[field] = FIELD_MESSAGES[field];
      }
      setErrors(next);
      return;
    }
    setErrors({});
    report.mutate({ input: parsed.data, file: attachment });
  }

  return (
    <form key={formKey} onSubmit={onSubmit} noValidate aria-labelledby="report-heading">
      <h2 id="report-heading">Report a defect</h2>

      <label>
        Aircraft
        <select
          name="aircraftId"
          defaultValue=""
          aria-invalid={Boolean(errors.aircraftId)}
          aria-describedby={errors.aircraftId ? 'aircraftId-error' : undefined}
        >
          <option value="" disabled>
            {aircraft.isPending ? 'Loading…' : 'Select aircraft'}
          </option>
          {aircraft.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.registration}
            </option>
          ))}
        </select>
      </label>
      {errors.aircraftId && <FieldError id="aircraftId-error" message={errors.aircraftId} />}
      {aircraft.error && <p role="alert">Could not load aircraft: {aircraft.error.message}</p>}

      <label>
        Title
        <input
          name="title"
          type="text"
          maxLength={120}
          aria-invalid={Boolean(errors.title)}
          aria-describedby={errors.title ? 'title-error' : undefined}
        />
      </label>
      {errors.title && <FieldError id="title-error" message={errors.title} />}

      <label>
        Description
        <textarea name="description" rows={3} />
      </label>
      {errors.description && <FieldError id="description-error" message={errors.description} />}

      <label>
        Attachment (optional)
        <input
          ref={fileInput}
          name="attachment"
          type="file"
          accept={ATTACHMENT_TYPES.join(',')}
          aria-invalid={Boolean(errors.attachment)}
          aria-describedby={errors.attachment ? 'attachment-error' : undefined}
        />
      </label>
      {errors.attachment && <FieldError id="attachment-error" message={errors.attachment} />}

      <button type="submit" disabled={report.isPending}>
        {report.isPending ? 'Saving…' : 'Report defect'}
      </button>

      {report.error && <p role="alert">Could not save the defect: {report.error.message}</p>}
      {report.data && !report.data.attachmentError && <p role="status">Defect reported.</p>}
      {report.data?.attachmentError && (
        <p role="alert">
          Defect reported, but the attachment was not saved: {report.data.attachmentError}
        </p>
      )}
    </form>
  );
}

function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} className="field-error">
      {message}
    </p>
  );
}
