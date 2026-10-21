import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DueDashboard } from './DueDashboard.tsx';
import { calls, mockFetch, renderWithClient } from './test-utils.tsx';

const taskId = '0b7d5c0e-3f5e-4a53-9c43-3f1ad0b6a111';
const aircraftId = 'df9b6e14-fc84-44f6-bcd5-1069bc8e32cf';
const item = (patch: object = {}) => ({
  taskId,
  taskName: 'A-check',
  aircraftId,
  registration: 'D-ASQA',
  status: 'overdue',
  governing: 'hours',
  remaining: -12.5,
  ...patch,
});
const dashboard = (items: object[]) =>
  Response.json({ computedAt: '2026-10-21T10:00:00.000Z', items });
const complete = `POST /api/maintenance-tasks/${taskId}/complete`;
const done = () => Response.json({ taskId, lastDoneAt: '2026-10-21T10:00:00.000Z' });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DueDashboard', () => {
  it('shows a loading state', () => {
    mockFetch({ 'GET /api/dashboard/due': () => new Promise<Response>(() => {}) });
    renderWithClient(<DueDashboard />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });

  it('shows an empty state', async () => {
    mockFetch({ 'GET /api/dashboard/due': () => dashboard([]) });
    renderWithClient(<DueDashboard />);
    expect(await screen.findByText('No maintenance tasks.')).toBeInTheDocument();
  });

  it('offers a retry after an error', async () => {
    let fail = true;
    mockFetch({
      'GET /api/dashboard/due': () =>
        fail ? Response.json({ message: 'boom' }, { status: 500 }) : dashboard([item()]),
    });
    const user = userEvent.setup();
    renderWithClient(<DueDashboard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');

    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('A-check')).toBeInTheDocument();
  });

  it('shows registration, task, status as text and the remaining with its unit', async () => {
    mockFetch({
      'GET /api/dashboard/due': () =>
        dashboard([
          item(),
          item({
            taskId: '1b7d5c0e-3f5e-4a53-9c43-3f1ad0b6a111',
            taskName: 'Gear',
            status: 'due-soon',
            governing: 'cycles',
            remaining: 40,
          }),
          item({
            taskId: '2b7d5c0e-3f5e-4a53-9c43-3f1ad0b6a111',
            taskName: 'Paint',
            status: 'ok',
            governing: 'days',
            remaining: 1,
          }),
        ]),
    });
    renderWithClient(<DueDashboard />);
    const row = (await screen.findByText('A-check')).closest('tr');
    expect(within(row as HTMLElement).getByText('D-ASQA')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('Overdue')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('12.5 h overdue')).toBeInTheDocument();
    expect(screen.getByText('40 cycles left')).toBeInTheDocument();
    expect(screen.getByText('1 day left')).toBeInTheDocument();
  });

  it('disables the button while pending and refetches after success', async () => {
    let resolve: (r: Response) => void = () => {};
    let dueCalls = 0;
    const fetchMock = mockFetch({
      'GET /api/dashboard/due': () => dashboard(++dueCalls === 1 ? [item()] : []),
      [complete]: () => new Promise<Response>((r) => (resolve = r)),
    });
    const user = userEvent.setup();
    renderWithClient(<DueDashboard />);
    await user.click(await screen.findByRole('button', { name: 'Mark done' }));
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();

    resolve(done());
    expect(await screen.findByText('No maintenance tasks.')).toBeInTheDocument();
    expect(calls(fetchMock).filter((c) => c === 'GET /api/dashboard/due')).toHaveLength(2);
  });

  it('shows an alert and keeps the row when completing fails', async () => {
    mockFetch({
      'GET /api/dashboard/due': () => dashboard([item()]),
      [complete]: () => Response.json({ message: 'nope' }, { status: 500 }),
    });
    const user = userEvent.setup();
    renderWithClient(<DueDashboard />);
    await user.click(await screen.findByRole('button', { name: 'Mark done' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('nope');
    await waitFor(() => expect(screen.getByText('A-check')).toBeInTheDocument());
  });
});
