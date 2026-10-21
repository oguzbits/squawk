import { AircraftList } from './AircraftList.tsx';
import { DefectForm } from './DefectForm.tsx';
import { DefectList } from './DefectList.tsx';
import { DueDashboard } from './DueDashboard.tsx';
import { ImportForm } from './ImportForm.tsx';

export function App() {
  return (
    <main>
      <h1>Squawk</h1>
      <AircraftList />
      <DueDashboard />
      <DefectForm />
      <DefectList />
      <ImportForm />
    </main>
  );
}
