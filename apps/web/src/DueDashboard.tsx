import type { DueItem } from '@squawk/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { completeTask, fetchDueDashboard } from './api.ts';

const STATUS_LABELS: Record<DueItem['status'], string> = {
  overdue: 'Overdue',
  'due-soon': 'Due soon',
  ok: 'OK',
};

const UNITS: Record<DueItem['governing'], [string, string]> = {
  hours: ['h', 'h'],
  cycles: ['cycle', 'cycles'],
  days: ['day', 'days'],
};

function describeRemaining({ remaining, governing }: DueItem): string {
  const amount = Number(Math.abs(remaining).toFixed(1));
  const [singular, plural] = UNITS[governing];
  return `${amount} ${amount === 1 ? singular : plural} ${remaining < 0 ? 'overdue' : 'left'}`;
}

export function DueDashboard() {
  const queryClient = useQueryClient();
  const { data, error, isPending, refetch, isRefetching } = useQuery({
    queryKey: ['due'],
    queryFn: fetchDueDashboard,
  });
  const complete = useMutation({
    mutationFn: completeTask,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['due'] }),
  });

  if (isPending) return <p role="status">Loading maintenance tasks…</p>;

  if (error) {
    return (
      <div role="alert">
        <p>Could not load maintenance tasks: {error.message}</p>
        <button type="button" onClick={() => void refetch()} disabled={isRefetching}>
          Retry
        </button>
      </div>
    );
  }

  if (data.items.length === 0) return <p>No maintenance tasks.</p>;

  return (
    <>
      <table>
        <caption>Maintenance due</caption>
        <thead>
          <tr>
            <th scope="col">Aircraft</th>
            <th scope="col">Task</th>
            <th scope="col">Status</th>
            <th scope="col">Remaining</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => {
            const saving = complete.isPending && complete.variables === item.taskId;
            return (
              <tr key={item.taskId}>
                <td>{item.registration}</td>
                <td>{item.taskName}</td>
                <td>{STATUS_LABELS[item.status]}</td>
                <td>{describeRemaining(item)}</td>
                <td>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => complete.mutate(item.taskId)}
                  >
                    {saving ? 'Saving…' : 'Mark done'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {complete.error && (
        <p role="alert">Could not mark the task as done: {complete.error.message}</p>
      )}
    </>
  );
}
