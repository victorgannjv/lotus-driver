-- Seed the extensible status lookup table. Add new statuses here (a new migration,
-- one INSERT) rather than hardcoding status strings in application code.
INSERT INTO statuses (code, label, sort_order, requires_photo, is_terminal_success, is_active) VALUES
  ('pending',   'Pending',   0, 0, 0, 1),
  ('arrived',   'Arrived',   1, 0, 0, 1),
  ('delivered', 'Delivered', 2, 1, 1, 1),
  ('failed',    'Failed',    3, 0, 0, 1),
  ('cancelled', 'Cancelled', 4, 0, 0, 1);
