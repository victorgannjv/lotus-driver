-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
--
-- Access control for the admin site: which staff may see or change what.
--
-- Until now an admin was an admin: the allowlist (users.role = 'admin') let
-- someone in and every screen, including the ones that delete drivers and
-- change what a late delivery is billed as, was theirs. That is the right
-- default for a pilot with two people and the wrong one for a team.
--
-- The model is a role per member of staff, and a role is a named set of
-- permissions over the site's modules, each None, View or Edit (Edit includes
-- View). Roles rather than per-person ticks because "Finance can see the
-- dashboard and evidence" is a decision made once about a job, not once per
-- person, and a new hire inherits it by being given the role.
--
-- The module catalogue itself lives in code (backend/access.py): modules are
-- features, and a feature and its permission have to ship together. The role's
-- JSON is just {"evidence": "view", "drivers": "edit"} against those keys; a key
-- the code no longer knows is ignored on read.
--
-- Enforcement is on the server for every admin endpoint. The screens hide what
-- you cannot use, but hiding is a courtesy, not the control.

CREATE TABLE access_role (
    id           BIGINT        NOT NULL AUTO_INCREMENT,
    name         VARCHAR(80)   NOT NULL,
    description  VARCHAR(255)  NULL,
    -- {"module": "view" | "edit"}; absent means no access. Ignored (and
    -- everything granted) for the system role, see is_system.
    permissions  TEXT          NOT NULL,
    -- The built-in full-access role. It cannot be edited or deleted, and its
    -- grants are computed from the module catalogue rather than read from
    -- `permissions`, so a module added in a later release is included without
    -- anyone remembering to edit a role. It is what stops the site from ever
    -- being locked.
    is_system    TINYINT(1)    NOT NULL DEFAULT 0,
    created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_access_role_name (name)
) DEFAULT CHARSET=utf8mb4;

ALTER TABLE users ADD COLUMN access_role_id BIGINT NULL;
ALTER TABLE users ADD CONSTRAINT fk_users_access_role FOREIGN KEY (access_role_id) REFERENCES access_role(id);

-- Starting roles. Only Administrator is load-bearing; the other two are
-- examples that are quicker to edit than to build from nothing.
INSERT INTO access_role (name, description, permissions, is_system) VALUES
  ('Administrator',
   'Full access to everything, including who else gets access. New areas of the site are included automatically.',
   '{}', 1),
  ('Operations',
   'Runs the day: sees every figure, trip and error, and manages drivers. Cannot change time limits, delay reasons or who has access.',
   '{"dashboard":"view","evidence":"view","orders":"view","diagnostics":"view","drivers":"edit","outlets":"view","windows":"view","targets":"view","reasons":"view","driver_app":"view","activity":"view"}',
   0),
  ('Viewer',
   'Read-only: the dashboard, evidence and orders. Cannot change anything.',
   '{"dashboard":"view","evidence":"view","orders":"view"}',
   0);

-- Everyone who can sign in today keeps exactly what they have today.
UPDATE users
   SET access_role_id = (SELECT id FROM access_role WHERE name = 'Administrator' AND is_system = 1)
 WHERE role = 'admin';
