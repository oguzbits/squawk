import { describe, expect, it } from 'vitest';
import { computeDue } from './maintenance.ts';

const hours = (intervalHours: number) => ({
  intervalHours,
  intervalCycles: null,
  intervalDays: null,
});
const zero = { hours: 0, cycles: 0, days: 0 };

describe('computeDue', () => {
  it('is ok when more than 10 % of the interval remain', () => {
    expect(computeDue(hours(100), { ...zero, hours: 89 })).toEqual({
      status: 'ok',
      governing: 'hours',
      remaining: 11,
    });
  });

  it('is due soon at exactly 10 % remaining', () => {
    expect(computeDue(hours(100), { ...zero, hours: 90 })).toMatchObject({
      status: 'due-soon',
      remaining: 10,
    });
  });

  it('is due soon, not overdue, at exactly 0 remaining', () => {
    expect(computeDue(hours(100), { ...zero, hours: 100 })).toMatchObject({
      status: 'due-soon',
      remaining: 0,
    });
  });

  it('is overdue below 0 remaining', () => {
    expect(computeDue(hours(100), { ...zero, hours: 101 })).toMatchObject({
      status: 'overdue',
      remaining: -1,
    });
  });

  it.each([
    [
      'cycles',
      { intervalHours: null, intervalCycles: 500, intervalDays: null },
      { ...zero, cycles: 600 },
    ],
    [
      'days',
      { intervalHours: null, intervalCycles: null, intervalDays: 365 },
      { ...zero, days: 400 },
    ],
  ] as const)('handles a %s interval alone', (governing, task, usage) => {
    expect(computeDue(task, usage)).toMatchObject({ status: 'overdue', governing });
  });

  it('is overdue with governing days when hours are fine but days are exceeded', () => {
    const task = { intervalHours: 600, intervalCycles: null, intervalDays: 365 };
    expect(computeDue(task, { hours: 10, cycles: 0, days: 366 })).toEqual({
      status: 'overdue',
      governing: 'days',
      remaining: -1,
    });
  });

  it('lets the smallest relative remaining govern', () => {
    const task = { intervalHours: 1000, intervalCycles: 100, intervalDays: 365 };
    // hours 50 % left, cycles 20 % left, days 80 % left
    expect(computeDue(task, { hours: 500, cycles: 80, days: 73 })).toEqual({
      status: 'ok',
      governing: 'cycles',
      remaining: 20,
    });
  });

  it('does not produce NaN for an aircraft without flights', () => {
    const result = computeDue(
      { intervalHours: null, intervalCycles: null, intervalDays: 30 },
      { ...zero, days: 3 },
    );
    expect(result).toEqual({ status: 'ok', governing: 'days', remaining: 27 });
  });

  it('rejects a task without any interval', () => {
    expect(() =>
      computeDue({ intervalHours: null, intervalCycles: null, intervalDays: null }, zero),
    ).toThrow();
  });
});
