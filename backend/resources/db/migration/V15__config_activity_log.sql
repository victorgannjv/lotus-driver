-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
--
-- An activity log for settings changes.
--
-- Settings here are not preferences -- a delivery window, a time allowance or
-- the party a reason code blames all decide how past trips are scored, because
-- variance is computed on read. So "why does last month read differently now?"
-- is a question that will be asked, and without this table the only answer is
-- a shrug. Recording who changed what, and from what to what, is also what
-- keeps a claim defensible when Lotus asks whether the bar moved after the
-- fact.
--
-- Append-only by intent: rows are written and never updated or deleted.
-- Additive migration -- nothing existing is touched.

CREATE TABLE config_audit (
    id          BIGINT       NOT NULL AUTO_INCREMENT,
    -- What kind of thing changed: reason_code, target, schedule, driver,
    -- admin, roster, setting.
    entity      VARCHAR(32)  NOT NULL,
    -- Which one, in whatever form identifies it (a code, an id, a key).
    entity_id   VARCHAR(120) NULL,
    action      ENUM('create','update','delete') NOT NULL,
    -- Human-readable summary, written at the point of change so the log stays
    -- readable even after the underlying row is edited again.
    summary     VARCHAR(500) NOT NULL,
    before_json TEXT         NULL,
    after_json  TEXT         NULL,
    actor_id    BIGINT       NULL,
    actor_email VARCHAR(255) NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_audit_time (created_at),
    KEY idx_audit_entity (entity, created_at)
) DEFAULT CHARSET=utf8mb4;

ALTER TABLE config_audit ADD CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id);
