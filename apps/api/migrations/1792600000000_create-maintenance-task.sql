-- Up Migration
CREATE TABLE maintenance_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES aircraft (id),
  name text NOT NULL,
  interval_hours numeric CHECK (interval_hours > 0),
  interval_cycles integer CHECK (interval_cycles > 0),
  interval_days integer CHECK (interval_days > 0),
  last_done_at timestamptz NOT NULL,
  CHECK (interval_hours IS NOT NULL OR interval_cycles IS NOT NULL OR interval_days IS NOT NULL)
);

CREATE INDEX maintenance_task_aircraft_id_idx ON maintenance_task (aircraft_id);

-- Down Migration
DROP TABLE maintenance_task;
