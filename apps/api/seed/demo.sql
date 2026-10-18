INSERT INTO aircraft (registration, model, msn) VALUES
  ('D-ASQA', 'A320-214', '5123'),
  ('D-ASQB', 'A320-214', '5187'),
  ('D-ASQC', 'A321-231', '6402'),
  ('D-ASQD', 'A320-251N', '8841'),
  ('D-ASQE', 'ATR 72-600', '1290'),
  ('D-ASQF', 'E190', '19000412')
ON CONFLICT (registration) DO NOTHING;
