export const CSV_HEADER = [
  'registration',
  'flight_date',
  'block_off',
  'block_on',
  'landings',
  'cycles',
] as const;
export const MAX_BLOCK_MS = 24 * 60 * 60 * 1000;

export type FlightRow = {
  line: number;
  registration: string;
  blockOff: string;
  blockOn: string;
  landings: number;
  cycles: number;
};

export type RejectedRow = { line: number; reason: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const REGISTRATION = /^[A-Z0-9]{1,2}-?[A-Z0-9]{1,5}$/;
const NON_NEGATIVE_INT = /^\d{1,6}$/;

const parseDate = (value: string): number =>
  DATE.test(value) ? Date.parse(`${value}T00:00:00Z`) : NaN;
const parseDateTime = (value: string): number => (DATE_TIME.test(value) ? Date.parse(value) : NaN);

// Reasons name the field only, never the value: logs and import records must not carry file content.
function validate(fields: string[], line: number): FlightRow | string {
  const [
    rawRegistration = '',
    flightDate = '',
    rawOff = '',
    rawOn = '',
    landings = '',
    cycles = '',
  ] = fields;
  const registration = rawRegistration.trim().toUpperCase();
  if (!REGISTRATION.test(registration)) return 'invalid registration';
  const date = parseDate(flightDate.trim());
  if (Number.isNaN(date) || new Date(date).toISOString().slice(0, 10) !== flightDate.trim()) {
    return 'invalid flight_date';
  }
  const off = parseDateTime(rawOff.trim());
  if (Number.isNaN(off)) return 'invalid block_off';
  const on = parseDateTime(rawOn.trim());
  if (Number.isNaN(on)) return 'invalid block_on';
  if (on <= off || on - off > MAX_BLOCK_MS)
    return 'invalid block_on: must be after block_off, at most 24 h';
  if (new Date(off).toISOString().slice(0, 10) !== flightDate.trim()) {
    return 'invalid flight_date: differs from block_off (UTC)';
  }
  if (!NON_NEGATIVE_INT.test(landings.trim())) return 'invalid landings';
  if (!NON_NEGATIVE_INT.test(cycles.trim())) return 'invalid cycles';
  return {
    line,
    registration,
    blockOff: new Date(off).toISOString(),
    blockOn: new Date(on).toISOString(),
    landings: Number(landings),
    cycles: Number(cycles),
  };
}

// shortcut: plain comma split, no quoted fields; upgrade when a source system quotes values.
export function parseFlightCsv(text: string): { rows: FlightRow[]; rejected: RejectedRow[] } {
  const lines = text.split(/\r?\n/);
  const header = (lines[0] ?? '').split(',').map((h) => h.trim());
  if (header.join(',') !== CSV_HEADER.join(',')) {
    throw new Error(`unexpected header, expected ${CSV_HEADER.join(',')}`);
  }
  const rows: FlightRow[] = [];
  const rejected: RejectedRow[] = [];
  lines.forEach((raw, index) => {
    if (index === 0 || raw.trim() === '') return;
    const fields = raw.split(',');
    if (fields.length !== CSV_HEADER.length) {
      rejected.push({ line: index + 1, reason: `expected ${CSV_HEADER.length} fields` });
      return;
    }
    const result = validate(fields, index + 1);
    if (typeof result === 'string') rejected.push({ line: index + 1, reason: result });
    else rows.push(result);
  });
  return { rows, rejected };
}
