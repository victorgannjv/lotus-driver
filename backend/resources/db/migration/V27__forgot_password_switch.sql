-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
--
-- The driver "Forgot password?" link becomes a switch.
--
-- Some fleets would rather a forgotten password go through a supervisor than
-- through an inbox the driver may not be able to open at work. Off hides the
-- link on the sign-in screen and makes the server refuse the request, so a
-- stale page or a direct call cannot send a reset email either.
--
-- It starts ON: nothing changes for anyone until an admin turns it off.
--
-- It governs only the driver-initiated request. A link an admin issues when
-- inviting a driver, and the admin's own "set a password" tool, are separate
-- and keep working -- they are how a driver gets in when this is off.

INSERT INTO app_setting (setting_key, value, notes) VALUES
  ('forgot_password_enabled', 'true',
   'Whether drivers see "Forgot password?" and can request a reset link by email. Off sends them to a supervisor instead.');
