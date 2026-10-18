import { useQuery } from '@tanstack/react-query';
import { fetchDefects } from './api.ts';

export function DefectList() {
  const { data, error, isPending, refetch, isRefetching } = useQuery({
    queryKey: ['defects'],
    queryFn: fetchDefects,
  });

  if (isPending) return <p role="status">Loading defects…</p>;

  if (error) {
    return (
      <div role="alert">
        <p>Could not load defects: {error.message}</p>
        <button type="button" onClick={() => void refetch()} disabled={isRefetching}>
          Retry
        </button>
      </div>
    );
  }

  if (data.length === 0) return <p>No defects reported.</p>;

  return (
    <table>
      <caption>Defects</caption>
      <thead>
        <tr>
          <th scope="col">Aircraft</th>
          <th scope="col">Title</th>
          <th scope="col">Status</th>
          <th scope="col">Reported</th>
          <th scope="col">Attachment</th>
        </tr>
      </thead>
      <tbody>
        {data.map((defect) => (
          <tr key={defect.id}>
            <td>{defect.aircraftRegistration}</td>
            <td>{defect.title}</td>
            <td>{defect.status}</td>
            <td>{new Date(defect.createdAt).toLocaleString()}</td>
            <td>
              {defect.attachment ? (
                <a href={defect.attachment.downloadUrl} rel="noopener noreferrer">
                  {defect.attachment.fileName}
                </a>
              ) : (
                '–'
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
