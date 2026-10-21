import { z } from 'zod';

export const DUE_SOON_RATIO = 0.1;

export const dueStatusSchema = z.enum(['overdue', 'due-soon', 'ok']);
export const governingSchema = z.enum(['hours', 'cycles', 'days']);

export const dueItemSchema = z.object({
  taskId: z.uuid(),
  taskName: z.string(),
  aircraftId: z.uuid(),
  registration: z.string(),
  status: dueStatusSchema,
  governing: governingSchema,
  remaining: z.number(),
});

export const dueDashboardSchema = z.object({
  computedAt: z.iso.datetime({ offset: true }),
  items: z.array(dueItemSchema),
});

export const completeTaskResponseSchema = z.object({
  taskId: z.uuid(),
  lastDoneAt: z.iso.datetime({ offset: true }),
});

export type DueStatus = z.infer<typeof dueStatusSchema>;
export type Governing = z.infer<typeof governingSchema>;
export type DueItem = z.infer<typeof dueItemSchema>;
export type DueDashboard = z.infer<typeof dueDashboardSchema>;
export type CompleteTaskResponse = z.infer<typeof completeTaskResponseSchema>;

export interface TaskIntervals {
  intervalHours: number | null;
  intervalCycles: number | null;
  intervalDays: number | null;
}

export interface Usage {
  hours: number;
  cycles: number;
  days: number;
}

const KINDS: { governing: Governing; interval: keyof TaskIntervals; used: keyof Usage }[] = [
  { governing: 'hours', interval: 'intervalHours', used: 'hours' },
  { governing: 'cycles', interval: 'intervalCycles', used: 'cycles' },
  { governing: 'days', interval: 'intervalDays', used: 'days' },
];

/** Pure rule: the interval with the smallest relative remaining governs the status. */
export function computeDue(
  task: TaskIntervals,
  usage: Usage,
): { status: DueStatus; governing: Governing; remaining: number } {
  let best: { governing: Governing; remaining: number; ratio: number } | undefined;
  let overdue = false;
  for (const kind of KINDS) {
    const interval = task[kind.interval];
    if (interval === null) continue;
    const remaining = interval - usage[kind.used];
    const ratio = remaining / interval;
    if (remaining < 0) overdue = true;
    if (!best || ratio < best.ratio) best = { governing: kind.governing, remaining, ratio };
  }
  if (!best) throw new Error('task has no interval');
  const status = overdue ? 'overdue' : best.ratio <= DUE_SOON_RATIO ? 'due-soon' : 'ok';
  return { status, governing: best.governing, remaining: best.remaining };
}
