-- Up Migration
CREATE TABLE flight_import (
  id uuid PRIMARY KEY,
  file_name text NOT NULL,
  size bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  imported integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  rejected integer NOT NULL DEFAULT 0,
  -- First rejected lines with a reason; never row content.
  rejections jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE flight (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES aircraft (id),
  import_id uuid NOT NULL REFERENCES flight_import (id),
  block_off timestamptz NOT NULL,
  block_on timestamptz NOT NULL CHECK (block_on > block_off),
  landings integer NOT NULL CHECK (landings >= 0),
  cycles integer NOT NULL CHECK (cycles >= 0),
  -- Makes every write idempotent: re-uploads and queue retries import nothing twice.
  UNIQUE (aircraft_id, block_off)
);

-- Down Migration
DROP TABLE flight;
DROP TABLE flight_import;
