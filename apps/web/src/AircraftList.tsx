import { useQuery } from '@tanstack/react-query';
import { fetchAircraft } from './api.ts';

export function AircraftList() {
  const { data, error, isPending, refetch, isRefetching } = useQuery({
    queryKey: ['aircraft'],
    queryFn: fetchAircraft,
  });

  if (isPending) return <p role="status">Loading aircraft…</p>;

  if (error) {
    return (
      <div role="alert">
        <p>Could not load aircraft: {error.message}</p>
        <button type="button" onClick={() => void refetch()} disabled={isRefetching}>
          Retry
        </button>
      </div>
    );
  }

  if (data.length === 0) return <p>No aircraft registered.</p>;

  return (
    <table>
      <caption>Fleet</caption>
      <thead>
        <tr>
          <th scope="col">Registration</th>
          <th scope="col">Model</th>
          <th scope="col">MSN</th>
        </tr>
      </thead>
      <tbody>
        {data.map((aircraft) => (
          <tr key={aircraft.id}>
            <td>{aircraft.registration}</td>
            <td>{aircraft.model}</td>
            <td>{aircraft.msn}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
