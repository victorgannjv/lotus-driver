-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
--
-- Overtime: how long a job (one driver's one day) may run before it counts as
-- overtime, so the Evidence page can flag the jobs that went over.
--
-- Stored in MINUTES, as a number: 510 is 8h 30m. The settings screen offers
-- hours and minutes boxes and does the arithmetic, so there is one unit in the
-- database and nothing to parse.
--
-- 0 means "not set", and it starts there. Nobody has agreed what counts as
-- overtime yet, and a number nobody chose would flag real drivers on day one
-- (the same reason the per-step time limits start switched off). Until an admin
-- sets it, nothing is flagged.
INSERT INTO app_setting (setting_key, value, notes) VALUES
  ('overtime_threshold_minutes', '0',
   'Worked minutes in one job above which it is flagged as overtime. 0 = not set, nothing is flagged.');
