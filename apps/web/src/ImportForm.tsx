import { IMPORT_MAX_BYTES, createImportInputSchema } from '@squawk/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { fetchImport, startImport } from './api.ts';

const POLL_MS = 1000;
const FILE_MESSAGE = `Choose a .csv file of up to ${IMPORT_MAX_BYTES / 1024 / 1024} MB.`;

export function ImportForm() {
  const [fileError, setFileError] = useState<string | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const start = useMutation({
    mutationFn: startImport,
    onSuccess: (created) => setImportId(created.id),
  });

  // Polls until the pipeline has processed the file.
  const result = useQuery({
    queryKey: ['import', importId],
    queryFn: () => fetchImport(importId ?? ''),
    enabled: importId !== null,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? POLL_MS : false),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    start.reset();
    setImportId(null);
    const file = fileInput.current?.files?.[0];
    const valid =
      file !== undefined &&
      file.name.toLowerCase().endsWith('.csv') &&
      createImportInputSchema.safeParse({ fileName: file.name, size: file.size }).success;
    if (!file || !valid) {
      setFileError(FILE_MESSAGE);
      return;
    }
    setFileError(null);
    start.mutate(file);
  }

  const data = result.data;
  return (
    <form onSubmit={onSubmit} noValidate aria-labelledby="import-heading">
      <h2 id="import-heading">Import flights</h2>
      <label>
        CSV file (registration, flight_date, block_off, block_on, landings, cycles)
        <input
          ref={fileInput}
          name="file"
          type="file"
          accept=".csv,text/csv"
          aria-invalid={Boolean(fileError)}
          aria-describedby={fileError ? 'file-error' : undefined}
        />
      </label>
      {fileError && (
        <p id="file-error" className="field-error">
          {fileError}
        </p>
      )}
      <button type="submit" disabled={start.isPending}>
        {start.isPending ? 'Uploading…' : 'Import'}
      </button>

      {start.error && <p role="alert">Could not start the import: {start.error.message}</p>}
      {result.error && (
        <p role="alert">
          Could not load the import result: {result.error.message}{' '}
          <button type="button" onClick={() => void result.refetch()}>
            Retry
          </button>
        </p>
      )}
      {importId && !data && !result.error && <p role="status">Loading…</p>}
      {data?.status === 'pending' && <p role="status">Processing…</p>}
      {data?.status === 'failed' && (
        <p role="alert">The file could not be imported: {data.rejections[0]?.reason}.</p>
      )}
      {data?.status === 'completed' && (
        <div role="status">
          <p>
            {data.imported} imported, {data.skipped} already known, {data.rejected} rejected.
          </p>
          {data.rejections.length > 0 && (
            <ul>
              {data.rejections.map((r) => (
                <li key={r.line}>
                  Line {r.line}: {r.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
