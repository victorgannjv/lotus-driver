-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
--
-- users.email was globally unique, so a @ninjavan.co address already on the admin
-- SSO allowlist could never also sign up as a driver (and vice versa for admin
-- allow-listing an existing driver's email) -- the two roles are separate logins
-- (SSO vs. password) and shouldn't share one identity slot. Replace the
-- table-wide uniqueness with one scoped to (email, role), so the same address can
-- back one admin row and one driver row at once.
--
-- OceanBase's MySQL-compat mode is safest with one logical change per ALTER TABLE
-- statement (see V6's note on combined-clause failures), so drop and add are split.

ALTER TABLE users DROP INDEX uq_users_email;
ALTER TABLE users ADD UNIQUE KEY uq_users_email_role (email, role);
