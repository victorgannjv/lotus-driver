-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
--
-- The system diagnostics log: one row per error anyone hit.
--
-- Three places can fail and until now only one of them left a trace anywhere
-- an admin could read. A backend exception went to the container log and
-- nowhere else; a JavaScript error on a driver's phone went to a console
-- nobody was holding; a request that never reached us at all (no signal, a
-- gateway timeout) left no record on either side. "The app did something
-- weird" had to be reproduced from a description.
--
--   backend  -- an exception, or a request refused in a way that points at
--               the app rather than the caller (5xx, and the 4xx that mean a
--               driver was blocked: 400/403/409/413/422/429)
--   driver   -- reported by the driver app itself: render crashes, uncaught
--               errors, requests that failed before reaching the backend
--   admin    -- the same, from the admin pages
--
-- fingerprint groups repeats of the same problem so fifty drivers hitting one
-- bug read as one issue seen fifty times, not fifty lines. Resolving works on
-- the fingerprint; a resolved issue that happens again simply shows up as open
-- again, which is how a regression announces itself.
--
-- The table is capped by the application (age and row count), not by a
-- schedule, because the platform provides no scheduler -- see
-- backend/diagnostics.py.

CREATE TABLE error_log (
    id           BIGINT        NOT NULL AUTO_INCREMENT,
    source       ENUM('backend','driver','admin') NOT NULL,
    -- exception | http_error | js_error | promise_rejection | render_error |
    -- network_error | gateway_error | test
    kind         VARCHAR(32)   NOT NULL,
    level        ENUM('error','warning') NOT NULL DEFAULT 'error',
    message      VARCHAR(1000) NOT NULL,
    -- Stack trace. Capped by the writer; MEDIUMTEXT because a deep React
    -- component stack is long and truncating it in the column would be silent.
    detail       MEDIUMTEXT    NULL,
    method       VARCHAR(10)   NULL,
    -- The API route (templated, e.g. /api/trips/{manifest_id}/checkpoints) for
    -- request failures; the page the user was on for everything else.
    path         VARCHAR(500)  NULL,
    status_code  INT           NULL,
    actor_type   ENUM('driver','admin') NULL,
    actor_id     BIGINT        NULL,
    -- Who it happened to, as the person would recognise it. An email for an
    -- admin; for a driver the id is stored and the name is joined on read, so
    -- a rename is not frozen into old rows.
    actor_label  VARCHAR(255)  NULL,
    user_agent   VARCHAR(500)  NULL,
    app_build    VARCHAR(40)   NULL,
    fingerprint  CHAR(40)      NOT NULL,
    resolved_at  DATETIME      NULL,
    resolved_by  VARCHAR(255)  NULL,
    created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_error_created (created_at),
    KEY idx_error_fingerprint (fingerprint, id),
    KEY idx_error_source_created (source, created_at)
) DEFAULT CHARSET=utf8mb4;
