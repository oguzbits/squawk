import { describe, expect, it } from 'vitest';
import { parseFlightCsv } from './parse.ts';

const HEADER = 'registration,flight_date,block_off,block_on,landings,cycles';
const OK = 'D-AIUA,2026-10-01,2026-10-01T08:00:00Z,2026-10-01T09:30:00Z,1,1';

const parse = (...lines: string[]) => parseFlightCsv([HEADER, ...lines].join('\n'));

describe('parseFlightCsv', () => {
  it('parses a valid row and normalizes the registration', () => {
    const { rows, rejected } = parse(
      ' d-aiua ,2026-10-01,2026-10-01T08:00:00Z,2026-10-01T09:30:00Z,2,1',
    );
    expect(rejected).toEqual([]);
    expect(rows).toEqual([
      {
        line: 2,
        registration: 'D-AIUA',
        blockOff: '2026-10-01T08:00:00.000Z',
        blockOn: '2026-10-01T09:30:00.000Z',
        landings: 2,
        cycles: 1,
      },
    ]);
  });

  it('accepts CRLF line endings and ignores empty lines', () => {
    const { rows } = parseFlightCsv(`${HEADER}\r\n${OK}\r\n\r\n`);
    expect(rows).toHaveLength(1);
  });

  it('rejects a file with a wrong header', () => {
    expect(() => parseFlightCsv('foo,bar\n1,2')).toThrow(/header/i);
  });

  it('rejects a row with the wrong number of fields and keeps the line number', () => {
    const { rows, rejected } = parse(OK, 'D-AIUA,2026-10-01');
    expect(rows).toHaveLength(1);
    expect(rejected).toEqual([{ line: 3, reason: 'expected 6 fields' }]);
  });

  it.each([
    [
      'empty registration',
      ',2026-10-01,2026-10-01T08:00:00Z,2026-10-01T09:30:00Z,1,1',
      'registration',
    ],
    ['bad date', 'D-AIUA,01.10.2026,2026-10-01T08:00:00Z,2026-10-01T09:30:00Z,1,1', 'flight_date'],
    [
      'non-existent date',
      'D-AIUA,2026-02-30,2026-02-30T08:00:00Z,2026-02-30T09:00:00Z,1,1',
      'flight_date',
    ],
    [
      'block_off without offset',
      'D-AIUA,2026-10-01,2026-10-01T08:00:00,2026-10-01T09:30:00Z,1,1',
      'block_off',
    ],
    [
      'block_on before block_off',
      'D-AIUA,2026-10-01,2026-10-01T09:30:00Z,2026-10-01T08:00:00Z,1,1',
      'block_on',
    ],
    [
      'block time over 24 h',
      'D-AIUA,2026-10-01,2026-10-01T08:00:00Z,2026-10-02T08:00:01Z,1,1',
      'block_on',
    ],
    [
      'date differs from block_off',
      'D-AIUA,2026-10-02,2026-10-01T08:00:00Z,2026-10-01T09:30:00Z,1,1',
      'flight_date',
    ],
    [
      'negative landings',
      'D-AIUA,2026-10-01,2026-10-01T08:00:00Z,2026-10-01T09:30:00Z,-1,1',
      'landings',
    ],
    [
      'fractional cycles',
      'D-AIUA,2026-10-01,2026-10-01T08:00:00Z,2026-10-01T09:30:00Z,1,1.5',
      'cycles',
    ],
  ])('rejects a row with %s', (_name, row, field) => {
    const { rows, rejected } = parse(row);
    expect(rows).toEqual([]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.line).toBe(2);
    expect(rejected[0]?.reason).toContain(field);
  });

  it('never puts row content into the rejection reason', () => {
    const { rejected } = parse(
      'SECRET-REG!,2026-10-01,2026-10-01T08:00:00Z,2026-10-01T09:30:00Z,1,1',
    );
    expect(rejected[0]?.reason).not.toContain('SECRET');
  });
});
