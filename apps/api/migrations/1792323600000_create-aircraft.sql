-- Up Migration
CREATE TABLE aircraft (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration text NOT NULL UNIQUE,
  model text NOT NULL,
  msn text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE aircraft;
