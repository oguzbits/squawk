import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AircraftList } from './AircraftList.tsx';

const aircraft = {
  id: 'df9b6e14-fc84-44f6-bcd5-1069bc8e32cf',
  registration: 'D-ASQA',
  model: 'A320-214',
  msn: '5123',
  createdAt: '2026-10-18T11:43:06.868Z',
};

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AircraftList />
    </QueryClientProvider>,
  );
}

const mockFetch = (...responses: Response[]) => {
  const fn = vi.fn<typeof fetch>();
  for (const res of responses) fn.mockResolvedValueOnce(res);
  vi.stubGlobal('fetch', fn);
  return fn;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AircraftList', () => {
  it('shows a loading state, then the fleet', async () => {
    mockFetch(Response.json([aircraft]));
    renderList();

    expect(screen.getByRole('status')).toHaveTextContent('Loading aircraft');
    expect(await screen.findByRole('cell', { name: 'D-ASQA' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'A320-214' })).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    mockFetch(Response.json([]));
    renderList();

    expect(await screen.findByText('No aircraft registered.')).toBeInTheDocument();
  });

  it('shows an error and recovers on retry', async () => {
    const fetchMock = mockFetch(new Response(null, { status: 503 }), Response.json([aircraft]));
    renderList();

    expect(await screen.findByRole('alert')).toHaveTextContent('status 503');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('cell', { name: 'D-ASQA' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a response that violates the schema as an error', async () => {
    mockFetch(Response.json([{ ...aircraft, id: 'not-a-uuid' }]));
    renderList();

    expect(await screen.findByRole('alert')).toHaveTextContent('unexpected response');
  });
});
