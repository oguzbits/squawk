import { AircraftList } from './AircraftList.tsx';
import { DefectForm } from './DefectForm.tsx';
import { DefectList } from './DefectList.tsx';

export function App() {
  return (
    <main>
      <h1>Squawk</h1>
      <AircraftList />
      <DefectForm />
      <DefectList />
    </main>
  );
}
