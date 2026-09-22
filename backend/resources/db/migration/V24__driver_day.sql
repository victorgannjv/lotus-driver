-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
--
-- A layer above Trip: everything one driver ran on one date. A driver makes
-- two or three trips a day, and "how was Ali's Tuesday" -- not "how was
-- trip 3000006" -- is the question a dispute or a roster check actually asks.
-- Nothing below Trip changes; a driver_day just groups the trips that already
-- exist, the same way a trip already groups its jobs and a job its orders.
--
-- (driver_id, work_date) is already how the app finds "today's trips" for a
-- driver everywhere else (see GET /my-days) -- this makes that pair a real
-- row instead of a query-time grouping, so a day can be paginated, linked to
-- and reported on the same way a trip or a job already can.
--
-- Column and its foreign key are added in separate statements (adding both in
-- one ALTER TABLE fails on OceanBase -- "Column not found", see V9's note).

CREATE TABLE driver_day (
    id          BIGINT   NOT NULL AUTO_INCREMENT,
    driver_id   BIGINT   NOT NULL,
    work_date   DATE     NOT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_driver_day (driver_id, work_date),
    CONSTRAINT fk_driver_day_driver FOREIGN KEY (driver_id) REFERENCES users(id)
) DEFAULT CHARSET=utf8mb4;

ALTER TABLE manifests ADD COLUMN driver_day_id BIGINT NULL;

-- Backfill: one driver_day per (driver_id, work_date) that already has trips,
-- then link every existing trip to it. Deterministic and complete -- unlike a
-- proof photo, a trip's driver and date were never optional -- so the column
-- is tightened to NOT NULL right after, instead of staying nullable forever
-- for the sake of rows that predate it.
INSERT INTO driver_day (driver_id, work_date)
SELECT DISTINCT driver_id, work_date FROM manifests;

UPDATE manifests m
JOIN driver_day d ON d.driver_id = m.driver_id AND d.work_date = m.work_date
SET m.driver_day_id = d.id;

ALTER TABLE manifests MODIFY COLUMN driver_day_id BIGINT NOT NULL;
ALTER TABLE manifests ADD CONSTRAINT fk_manifests_driver_day FOREIGN KEY (driver_day_id) REFERENCES driver_day(id);
