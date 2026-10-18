import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DefectList } from './DefectList.tsx';
import { mockFetch, renderWithClient } from './test-utils.tsx';

const base = {
  aircraftId: 'df9b6e14-fc84-44f6-bcd5-1069bc8e32cf',
  aircraftRegistration: 'D-ASQA',
  description: '',
  status: 'open',
  createdAt: '2026-10-18T12:00:00.000Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DefectList', () => {
  it('shows defects with a download link only where an attachment exists', async () => {
    mockFetch({
      'GET /api/defects': () =>
        Response.json([
          {
            ...base,
            id: '0b7d5c0e-3f5e-4a53-9c43-3f1ad0b6a111',
            title: 'Cracked windscreen',
            attachment: {
              fileName: 'crack.png',
              contentType: 'image/png',
              size: 10,
              downloadUrl: 'http://localhost:4566/squawk-attachments/x?sig=1',
            },
          },
          {
            ...base,
            id: '1c7d5c0e-3f5e-4a53-9c43-3f1ad0b6a222',
            title: 'Seat belt frayed',
            attachment: null,
          },
        ]),
    });
    renderWithClient(<DefectList />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading defects');
    expect(await screen.findByRole('link', { name: 'crack.png' })).toHaveAttribute(
      'href',
      'http://localhost:4566/squawk-attachments/x?sig=1',
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('cell', { name: 'Seat belt frayed' })).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    mockFetch({ 'GET /api/defects': () => Response.json([]) });
    renderWithClient(<DefectList />);

    expect(await screen.findByText('No defects reported.')).toBeInTheDocument();
  });

  it('shows an error and recovers on retry', async () => {
    let attempts = 0;
    mockFetch({
      'GET /api/defects': () =>
        ++attempts === 1 ? new Response(null, { status: 503 }) : Response.json([]),
    });
    renderWithClient(<DefectList />);

    expect(await screen.findByRole('alert')).toHaveTextContent('status 503');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('No defects reported.')).toBeInTheDocument();
  });
});
