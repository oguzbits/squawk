-- Up Migration
CREATE TABLE defect (
  id uuid PRIMARY KEY,
  aircraft_id uuid NOT NULL REFERENCES aircraft (id),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  attachment_key text,
  attachment_file_name text,
  attachment_content_type text,
  attachment_size bigint,
  attachment_uploaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (attachment_key IS NULL) = (attachment_file_name IS NULL)
    AND (attachment_key IS NULL) = (attachment_content_type IS NULL)
    AND (attachment_key IS NULL) = (attachment_size IS NULL)
    AND (attachment_uploaded_at IS NULL OR attachment_key IS NOT NULL)
  )
);

CREATE INDEX defect_aircraft_id_created_at_idx ON defect (aircraft_id, created_at DESC);

-- Down Migration
DROP TABLE defect;
