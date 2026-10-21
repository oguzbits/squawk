import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportForm } from './ImportForm.tsx';
import { calls, mockFetch, renderWithClient } from './test-utils.tsx';

const id = '0b7d5c0e-3f5e-4a53-9c43-3f1ad0b6a111';
const S3_URL = 'http://localhost:4566/squawk-attachments';
const record = (patch: object) => ({
  id,
  fileName: 'flights.csv',
  status: 'pending',
  imported: 0,
  skipped: 0,
  rejected: 0,
  rejections: [],
  createdAt: '2026-10-20T12:00:00.000Z',
  completedAt: null,
  ...patch,
});
const created = () =>
  Response.json(
    { import: record({}), upload: { url: S3_URL, fields: { key: `imports/${id}.csv` } } },
    { status: 201 },
  );
const csv = (name = 'flights.csv') => new File(['a,b\n'], name, { type: 'text/csv' });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ImportForm', () => {
  it('rejects a file that is not a CSV and sends nothing', async () => {
    const fetchMock = mockFetch({});
    const user = userEvent.setup({ applyAccept: false });
    renderWithClient(<ImportForm />);

    await user.upload(screen.getByLabelText(/CSV file/), new File(['x'], 'notes.txt'));
    await user.click(screen.getByRole('button', { name: 'Import' }));

    expect(screen.getByText(/Choose a .csv file/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uploads the file, waits for processing and shows the result with rejected lines', async () => {
    let polls = 0;
    const fetchMock = mockFetch({
      'POST /api/imports': created,
      [`POST ${S3_URL}`]: () => new Response(null, { status: 204 }),
      [`GET /api/imports/${id}`]: () =>
        Response.json(
          ++polls === 1
            ? record({})
            : record({
                status: 'completed',
                imported: 3,
                skipped: 1,
                rejected: 1,
                rejections: [{ line: 5, reason: 'invalid landings' }],
              }),
        ),
    });
    const user = userEvent.setup();
    renderWithClient(<ImportForm />);

    await user.upload(screen.getByLabelText(/CSV file/), csv());
    await user.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByText('Processing…')).toBeInTheDocument();
    // The poll interval is 1 s, longer than the default wait.
    expect(
      await screen.findByText('3 imported, 1 already known, 1 rejected.', {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Line 5: invalid landings')).toBeInTheDocument();
    expect(calls(fetchMock).slice(0, 2)).toEqual(['POST /api/imports', `POST ${S3_URL}`]);
  });

  it('reports a failed storage upload and shows no result', async () => {
    mockFetch({
      'POST /api/imports': created,
      [`POST ${S3_URL}`]: () => new Response(null, { status: 403 }),
    });
    const user = userEvent.setup();
    renderWithClient(<ImportForm />);

    await user.upload(screen.getByLabelText(/CSV file/), csv());
    await user.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Upload to storage failed');
  });

  it('offers a retry when the result cannot be loaded', async () => {
    let fail = true;
    mockFetch({
      'POST /api/imports': created,
      [`POST ${S3_URL}`]: () => new Response(null, { status: 204 }),
      [`GET /api/imports/${id}`]: () =>
        fail
          ? Response.json({ message: 'boom' }, { status: 500 })
          : Response.json(record({ status: 'completed', imported: 2 })),
    });
    const user = userEvent.setup();
    renderWithClient(<ImportForm />);

    await user.upload(screen.getByLabelText(/CSV file/), csv());
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');

    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/2 imported/)).toBeInTheDocument();
  });
});
