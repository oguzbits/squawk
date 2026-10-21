INSERT INTO aircraft (registration, model, msn) VALUES
  ('D-ASQA', 'A320-214', '5123'),
  ('D-ASQB', 'A320-214', '5187'),
  ('D-ASQC', 'A321-231', '6402'),
  ('D-ASQD', 'A320-251N', '8841'),
  ('D-ASQE', 'ATR 72-600', '1290'),
  ('D-ASQF', 'E190', '19000412')
ON CONFLICT (registration) DO NOTHING;

-- Maintenance tasks for the demo fleet; the dashboard shows one overdue, one due-soon and one fine task.
INSERT INTO maintenance_task (aircraft_id, name, interval_hours, interval_cycles, interval_days, last_done_at)
SELECT a.id, t.name, t.interval_hours, t.interval_cycles, t.interval_days, now() - t.age
FROM aircraft a
JOIN (VALUES
  ('D-ASQA', 'A-check', 600, NULL, 120, interval '150 days'),
  ('D-ASQB', 'Landing gear inspection', NULL, 1000, 365, interval '340 days'),
  ('D-ASQC', 'Cabin pressure test', NULL, NULL, 180, interval '20 days'),
  ('D-ASQD', 'Engine borescope', 1500, 800, NULL, interval '10 days')
) AS t (registration, name, interval_hours, interval_cycles, interval_days, age) ON t.registration = a.registration
WHERE NOT EXISTS (
  SELECT 1 FROM maintenance_task m WHERE m.aircraft_id = a.id AND m.name = t.name
);
