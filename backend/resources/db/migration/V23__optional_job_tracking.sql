-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
--
-- Drops and parcels become an optional layer.
--
-- A trip is really two things recorded at once: WHEN the truck was at the
-- outlet, and WHAT it carried. The dispute with Lotus is built almost
-- entirely on the first -- arrival, departure, and the time between them
-- measured against a contracted window. The second is how we reconcile the
-- load.
--
-- During adoption those two are not equally ready. Asking a driver how many
-- drops the trip carries, and then to scan each parcel into each drop, is the
-- longest and most error-prone part of the app, and a driver who is still
-- learning the checkpoint flow will abandon the whole thing at that sheet. So
-- the load layer can be switched off while the timing layer is proven, and
-- switched back on without a deploy.
--
-- Off means: no job-count sheet, no drop list, no parcel scanning, and no
-- "deliveries done" checkpoint -- that one is fired by the server when the
-- last drop closes, and with no drops it would sit unstamped forever.
--
-- Nothing already recorded is touched. A trip that ran with drops keeps them,
-- and every claim built on them still reads.

INSERT INTO app_setting (setting_key, value, notes) VALUES
  ('job_tracking_enabled', 'true',
   'Whether the app asks for drops and parcels at all. Off leaves only the checkpoint timings.');
