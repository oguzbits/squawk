import { computeDue, type DueItem } from '@squawk/shared';
import type pg from 'pg';

interface TaskRow {
  id: string;
  name: string;
  aircraft_id: string;
  registration: string;
  interval_hours: string | null;
  interval_cycles: number | null;
  interval_days: number | null;
  last_done_at: Date;
  hours: string;
  cycles: string;
}

const STATUS_RANK = { overdue: 0, 'due-soon': 1, ok: 2 } as const;
const DAY_MS = 24 * 60 * 60 * 1000;

// Usage is aggregated per task in PostgreSQL; the unique index on (aircraft_id, block_off) serves the lateral join.
export async function loadDueItems(pool: pg.Pool, now: Date): Promise<DueItem[]> {
  const { rows: tasks } = await pool.query<TaskRow>(
    `SELECT t.id, t.name, t.aircraft_id, a.registration, t.interval_hours, t.interval_cycles,
            t.interval_days, t.last_done_at, COALESCE(u.hours, 0) AS hours, COALESCE(u.cycles, 0) AS cycles
     FROM maintenance_task t
     JOIN aircraft a ON a.id = t.aircraft_id
     LEFT JOIN LATERAL (
       SELECT SUM(EXTRACT(EPOCH FROM f.block_on - f.block_off)) / 3600 AS hours, SUM(f.cycles) AS cycles
       FROM flight f WHERE f.aircraft_id = t.aircraft_id AND f.block_off >= t.last_done_at
     ) u ON true`,
  );

  const computed = [];
  for (const task of tasks) {
    const intervals = {
      intervalHours: task.interval_hours === null ? null : Number(task.interval_hours),
      intervalCycles: task.interval_cycles,
      intervalDays: task.interval_days,
    };
    const due = computeDue(intervals, {
      hours: Number(task.hours),
      cycles: Number(task.cycles),
      days: Math.floor((now.getTime() - task.last_done_at.getTime()) / DAY_MS),
    });
    const interval = {
      hours: intervals.intervalHours,
      cycles: intervals.intervalCycles,
      days: intervals.intervalDays,
    }[due.governing] as number;
    computed.push({
      ratio: due.remaining / interval,
      item: {
        taskId: task.id,
        taskName: task.name,
        aircraftId: task.aircraft_id,
        registration: task.registration,
        ...due,
      } satisfies DueItem,
    });
  }

  return computed
    .sort(
      (a, b) =>
        STATUS_RANK[a.item.status] - STATUS_RANK[b.item.status] ||
        a.ratio - b.ratio ||
        a.item.registration.localeCompare(b.item.registration),
    )
    .map((c) => c.item);
}
