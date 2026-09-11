-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
--
-- Lateness against the CONTRACT, not just dwell time.
--
-- V13 measured how long each step took (a 15-minute target on waiting for
-- goods, and so on). That answers "how long were we held", which is diagnostic,
-- but it is not what Lotus charges on. The contract commits each run to an
-- absolute window -- first trip 09:30-12:00, second 13:00-15:00, last
-- 15:00-17:00 -- and "late" means missing that window, whatever the individual
-- gaps looked like.
--
-- Both measures are kept because they answer different halves of one argument:
-- the window says WHETHER the commitment was missed, and the gaps say WHY. The
-- split falls out of the two together -- if the driver arrived inside the
-- window but left after it closed, the overrun belongs to the outlet; if the
-- driver arrived late, that part is ours before anything else is counted.
--
-- Additive only: no table or column is dropped, nothing is deleted, and trips
-- recorded before this migration simply have no window to compare against.

CREATE TABLE trip_schedule (
    id            BIGINT      NOT NULL AUTO_INCREMENT,
    -- NULL = applies to every outlet; a row naming an outlet overrides it.
    warehouse_id  BIGINT      NULL,
    -- Which run of the day this window governs: 1 = first trip, 2 = second.
    slot_no       INT         NOT NULL,
    label         VARCHAR(64) NOT NULL,
    window_start  TIME        NOT NULL,
    window_end    TIME        NOT NULL,
    -- Minutes of lateness tolerated before a run counts as missing its window.
    grace_minutes INT         NOT NULL DEFAULT 0,
    is_active     TINYINT(1)  NOT NULL DEFAULT 1,
    created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_schedule_lookup (warehouse_id, slot_no, is_active)
) DEFAULT CHARSET=utf8mb4;

ALTER TABLE trip_schedule ADD CONSTRAINT fk_schedule_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);

-- Global defaults, from the contracted pattern. Admins can override these per
-- outlet, or edit them outright when the contract is renegotiated -- and because
-- variance is computed on read, changing a window re-scores history, which is
-- what you want while the schedule is still being argued over.
INSERT INTO trip_schedule (warehouse_id, slot_no, label, window_start, window_end, grace_minutes) VALUES
  (NULL, 1, 'First trip',  '09:30:00', '12:00:00', 0),
  (NULL, 2, 'Second trip', '13:00:00', '15:00:00', 0),
  (NULL, 3, 'Last trip',   '15:00:00', '17:00:00', 0);

-- Which contracted window a trip was run against. Set when the trip starts, so
-- that re-ordering or cancelling a later trip never retro-changes an earlier
-- one's commitment. Nullable: trips before this migration have no slot.
ALTER TABLE manifests ADD COLUMN schedule_slot_no INT NULL;
