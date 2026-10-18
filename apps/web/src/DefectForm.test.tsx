import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { DefectForm } from './DefectForm.tsx';
import { calls, mockFetch, renderWithClient } from './test-utils.tsx';

const aircraftId = 'df9b6e14-fc84-44f6-bcd5-1069bc8e32cf';
const aircraft = {
  id: aircraftId,
  registration: 'D-ASQA',
  model: 'A320-214',
  msn: '5123',
  createdAt: '2026-10-18T11:43:06.868Z',
};
const defect = {
  id: '0b7d5c0e-3f5e-4a53-9c43-3f1ad0b6a111',
  aircraftId,
  aircraftRegistration: 'D-ASQA',
  title: 'Cracked windscreen',
  description: '',
  status: 'open',
  attachment: null,
  createdAt: '2026-10-18T12:00:00.000Z',
};
const S3_URL = 'http://localhost:4566/squawk-attachments';
const upload = { url: S3_URL, fields: { key: 'defects/x/y', 'Content-Type': 'image/png' } };

const baseRoutes = {
  'GET /api/aircraft': () => Response.json([aircraft]),
  'GET /api/defects': () => Response.json([]),
};

async function fillBasics(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('option', { name: 'D-ASQA' });
  await user.selectOptions(screen.getByLabelText('Aircraft'), aircraftId);
  await user.type(screen.getByLabelText('Title'), 'Cracked windscreen');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DefectForm validation', () => {
  it('shows field errors and sends nothing when the input is invalid', async () => {
    const fetchMock = mockFetch(baseRoutes);
    renderWithClient(<DefectForm />);
    await screen.findByRole('option', { name: 'D-ASQA' });

    await userEvent.click(screen.getByRole('button', { name: 'Report defect' }));

    expect(screen.getByText('Select an aircraft.')).toBeInTheDocument();
    expect(screen.getByText(/title of 3 to 120/)).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeInvalid();
    expect(calls(fetchMock)).not.toContain('POST /api/defects');
  });

  it('rejects an attachment with an unsupported type', async () => {
    const fetchMock = mockFetch(baseRoutes);
    const user = userEvent.setup({ applyAccept: false });
    renderWithClient(<DefectForm />);
    await fillBasics(user);

    await user.upload(
      screen.getByLabelText(/Attachment/),
      new File(['x'], 'run.exe', { type: 'application/x-msdownload' }),
    );
    await user.click(screen.getByRole('button', { name: 'Report defect' }));

    expect(screen.getByText(/Attach a JPEG, PNG or PDF/)).toBeInTheDocument();
    expect(calls(fetchMock)).not.toContain('POST /api/defects');
  });
});

describe('DefectForm submission', () => {
  it('creates the defect, uploads straight to storage and confirms the upload', async () => {
    const fetchMock = mockFetch({
      ...baseRoutes,
      'POST /api/defects': () => Response.json({ defect, upload }, { status: 201 }),
      [`POST ${S3_URL}`]: () => new Response(null, { status: 204 }),
      [`POST /api/defects/${defect.id}/attachment/complete`]: () => Response.json(defect),
    });
    const user = userEvent.setup();
    renderWithClient(<DefectForm />);
    await fillBasics(user);
    await user.upload(
      screen.getByLabelText(/Attachment/),
      new File([new Uint8Array(10)], 'crack.png', { type: 'image/png' }),
    );

    await user.click(screen.getByRole('button', { name: 'Report defect' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Defect reported.');
    expect(calls(fetchMock).filter((c) => c.startsWith('POST'))).toEqual([
      'POST /api/defects',
      `POST ${S3_URL}`,
      `POST /api/defects/${defect.id}/attachment/complete`,
    ]);

    const create = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(create?.[1]?.body))).toEqual({
      aircraftId,
      title: 'Cracked windscreen',
      description: '',
      attachment: { fileName: 'crack.png', contentType: 'image/png', size: 10 },
    });

    const s3Call = fetchMock.mock.calls.find(([url]) => url === S3_URL);
    const form = s3Call?.[1]?.body as FormData;
    expect(form.get('key')).toBe('defects/x/y');
    expect(form.get('file')).toBeInstanceOf(File);
    expect([...form.keys()].at(-1)).toBe('file');
  });

  it('keeps the defect and reports it when the storage upload fails', async () => {
    const fetchMock = mockFetch({
      ...baseRoutes,
      'POST /api/defects': () => Response.json({ defect, upload }, { status: 201 }),
      [`POST ${S3_URL}`]: () => new Response('denied', { status: 403 }),
    });
    const user = userEvent.setup();
    renderWithClient(<DefectForm />);
    await fillBasics(user);
    await user.upload(
      screen.getByLabelText(/Attachment/),
      new File([new Uint8Array(10)], 'crack.png', { type: 'image/png' }),
    );

    await user.click(screen.getByRole('button', { name: 'Report defect' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Defect reported, but the attachment was not saved: Upload to storage failed with status 403',
    );
    expect(calls(fetchMock)).not.toContain(`POST /api/defects/${defect.id}/attachment/complete`);
  });

  it('shows the server message when the defect cannot be created', async () => {
    mockFetch({
      ...baseRoutes,
      'POST /api/defects': () =>
        Response.json(
          { statusCode: 404, error: 'Not Found', message: 'Aircraft not found' },
          { status: 404 },
        ),
    });
    const user = userEvent.setup();
    renderWithClient(<DefectForm />);
    await fillBasics(user);

    await user.click(screen.getByRole('button', { name: 'Report defect' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Aircraft not found');
  });

  it('disables the button while saving and clears the form afterwards', async () => {
    let finish: (res: Response) => void = () => {};
    mockFetch({
      ...baseRoutes,
      'POST /api/defects': () => new Promise<Response>((resolve) => (finish = resolve)),
    });
    const user = userEvent.setup();
    renderWithClient(<DefectForm />);
    await fillBasics(user);

    await user.click(screen.getByRole('button', { name: 'Report defect' }));
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();

    finish(Response.json({ defect, upload: null }, { status: 201 }));
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue(''));
  });
});
