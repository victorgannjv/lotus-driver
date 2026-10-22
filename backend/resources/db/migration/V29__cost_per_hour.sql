-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
--
-- Cost per hour: what an hour of a driver's working time costs, in RM. The
-- Driver performance page multiplies each driver's total worked hours by it to
-- show a total cost.
--
-- Stored as a plain decimal string ("25.50"), like the other settings. 0 means
-- "not set", and it starts there: nobody has entered a rate yet, and a made-up
-- one would put invented money figures in front of people. Until it is set the
-- cost column is blank.
INSERT INTO app_setting (setting_key, value, notes) VALUES
  ('cost_per_hour', '0',
   'RM per worked hour, used for the total cost on Driver performance. 0 = not set, no cost is shown.');
