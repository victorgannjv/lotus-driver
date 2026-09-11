-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
--
-- Adds the trip-checkpoint spine the Lotus dispute case needs: every visit to an
-- outlet is stamped at five points, the gaps between them are measured against
-- targets that live in data, and a delay that runs over its target is explained
-- with a coded reason that carries a fault owner. Also introduces the job (drop)
-- layer between a trip and its scanned orders.
--
-- This migration is deliberately ADDITIVE ONLY. Unlike V6 it drops no column,
-- deletes no row and removes nobody's access: every existing driver, admin,
-- outlet, manifest, order, event and photo survives untouched, and the existing
-- scan flow keeps working unchanged against them. Existing warehouse arrivals are
-- BACKFILLED into the new checkpoint table at the end so past trips still have
-- their first checkpoint rather than starting blank.
--
-- OceanBase's MySQL-compat mode is safest with one logical change per statement
-- (see V6's note on combined-clause failures, and V9/V10 on adding a column and
-- its foreign key separately), so that shape is kept throughout.

-- ---------------------------------------------------------------------------
-- Reason codes. Replaces the free-text delivery_events.failure_reason as the
-- thing we report on: free text cannot be ranked, and "which reason costs us
-- most" is the whole point of the dispute dashboard. The free-text column stays
-- (see below) as an optional note alongside the code.
-- ---------------------------------------------------------------------------
CREATE TABLE reason_code (
    code            VARCHAR(48)  NOT NULL,
    label           VARCHAR(160) NOT NULL,
    -- Who the lost time belongs to. 'njv' time is conceded before a claim is
    -- filed; 'external' is nobody's fault and is excluded from both sides.
    fault_party     ENUM('lotus','njv','external') NOT NULL,
    -- Which gap this reason may be offered for. 'any' = always offered.
    applies_to_gap  VARCHAR(160) NOT NULL DEFAULT 'any',
    sort_order      INT          NOT NULL DEFAULT 0,
    is_active       TINYINT(1)   NOT NULL DEFAULT 1,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (code),
    KEY idx_reason_party (fault_party, is_active)
) DEFAULT CHARSET=utf8mb4;

INSERT INTO reason_code (code, label, fault_party, applies_to_gap, sort_order) VALUES
  ('LOT_NOT_STAGED',  'Goods not picked / not staged', 'lotus',    'waiting_for_lotus,loading', 10),
  ('LOT_NO_BAY',      'No loading bay free',           'lotus',    'waiting_for_lotus,loading', 20),
  ('LOT_STAFF',       'Lotus staff shortage',          'lotus',    'any',                       30),
  ('LOT_DOC',         'Invoice or DO not ready',       'lotus',    'any',                       40),
  ('LOT_SYSTEM',      'Lotus system down',             'lotus',    'any',                       50),
  ('LOT_SHORT_GOODS', 'Short or wrong goods',          'lotus',    'loading',                   60),
  ('LOT_NO_BASKET',   'Basket not available',          'lotus',    'return_leg',                70),
  ('NJV_LATE',        'Driver arrived late',           'njv',      'any',                      110),
  ('NJV_VEHICLE',     'Vehicle breakdown',             'njv',      'any',                      120),
  ('NJV_CAPACITY',    'Truck capacity short',          'njv',      'loading,departure_lag',    130),
  ('NJV_BREAK',       'Driver on break',               'njv',      'any',                      140),
  ('NJV_PAPERWORK',   'Paperwork error',               'njv',      'any',                      150),
  ('NJV_SHORTHANDED', 'Short-handed today',            'njv',      'any',                      160),
  ('EXT_TRAFFIC',     'Traffic',                       'external', 'delivery_round,return_leg',210),
  ('EXT_WEATHER',     'Weather',                       'external', 'any',                      220),
  ('EXT_ROAD',        'Road closure',                  'external', 'delivery_round,return_leg',230),
  ('EXT_ACCIDENT',    'Accident on route',             'external', 'delivery_round,return_leg',240);

-- ---------------------------------------------------------------------------
-- Gap targets. Thresholds in data, not code, so ops can retune them without a
-- redeploy -- and because changing a target has to re-score history (the target
-- is still being negotiated with Lotus), gaps are computed on read and never
-- stored. warehouse_id NULL = the global default; a row naming an outlet
-- overrides the default for that outlet only.
-- ---------------------------------------------------------------------------
CREATE TABLE gap_target (
    id              BIGINT      NOT NULL AUTO_INCREMENT,
    gap_code        VARCHAR(48) NOT NULL,
    warehouse_id    BIGINT      NULL,
    target_minutes  INT         NOT NULL,
    created_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_gap_target_lookup (gap_code, warehouse_id)
) DEFAULT CHARSET=utf8mb4;

ALTER TABLE gap_target ADD CONSTRAINT fk_gap_target_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);

-- Global defaults. 'time_at_outlet' is the headline dispute number: arrival to
-- departure, i.e. how long Lotus kept the truck on site.
INSERT INTO gap_target (gap_code, warehouse_id, target_minutes) VALUES
  ('waiting_for_lotus', NULL,  15),
  ('loading',           NULL,  30),
  ('departure_lag',     NULL,  10),
  ('delivery_round',    NULL, 240),
  ('return_leg',        NULL,  45),
  ('time_at_outlet',    NULL,  55);

-- ---------------------------------------------------------------------------
-- The checkpoint spine. One row per stamped moment in a trip. Append-only in
-- spirit; a correction updates the row and the app records who did it, so the
-- evidence trail stays answerable.
-- ---------------------------------------------------------------------------
CREATE TABLE trip_checkpoint (
    id           BIGINT        NOT NULL AUTO_INCREMENT,
    manifest_id  BIGINT        NOT NULL,
    checkpoint   ENUM('arrived','goods_ready','loaded','departed','deliveries_done','returned') NOT NULL,
    occurred_at  DATETIME      NOT NULL,
    lat          DECIMAL(10,7) NULL,
    lng          DECIMAL(10,7) NULL,
    photo_id     BIGINT        NULL,
    -- Populated only when the gap ending at this checkpoint ran over target.
    reason_code  VARCHAR(48)   NULL,
    reason_note  VARCHAR(500)  NULL,
    -- Set when an admin re-codes a driver's reason; the original stays visible.
    original_reason_code VARCHAR(48) NULL,
    recoded_by   BIGINT        NULL,
    recoded_at   DATETIME      NULL,
    created_by   BIGINT        NULL,
    created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_checkpoint_per_trip (manifest_id, checkpoint),
    KEY idx_checkpoint_time (occurred_at)
) DEFAULT CHARSET=utf8mb4;

ALTER TABLE trip_checkpoint ADD CONSTRAINT fk_cp_manifest FOREIGN KEY (manifest_id) REFERENCES manifests(id);
ALTER TABLE trip_checkpoint ADD CONSTRAINT fk_cp_photo    FOREIGN KEY (photo_id)    REFERENCES photos(id);
ALTER TABLE trip_checkpoint ADD CONSTRAINT fk_cp_reason   FOREIGN KEY (reason_code) REFERENCES reason_code(code);
ALTER TABLE trip_checkpoint ADD CONSTRAINT fk_cp_recoder  FOREIGN KEY (recoded_by)  REFERENCES users(id);
ALTER TABLE trip_checkpoint ADD CONSTRAINT fk_cp_creator  FOREIGN KEY (created_by)  REFERENCES users(id);

-- ---------------------------------------------------------------------------
-- The job (drop) layer between a trip and its scanned orders. The driver enters
-- how many jobs a trip carries at loading time -- until Lotus exposes an API
-- that is the only honest source -- and may append one if the load changes.
-- ---------------------------------------------------------------------------
CREATE TABLE trip_job (
    id            BIGINT      NOT NULL AUTO_INCREMENT,
    manifest_id   BIGINT      NOT NULL,
    seq           INT         NOT NULL,
    status        ENUM('pending','done','failed') NOT NULL DEFAULT 'pending',
    started_at    DATETIME    NULL,
    completed_at  DATETIME    NULL,
    lat           DECIMAL(10,7) NULL,
    lng           DECIMAL(10,7) NULL,
    photo_id      BIGINT      NULL,
    created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_trip_job_seq (manifest_id, seq),
    KEY idx_trip_job_status (manifest_id, status)
) DEFAULT CHARSET=utf8mb4;

ALTER TABLE trip_job ADD CONSTRAINT fk_trip_job_manifest FOREIGN KEY (manifest_id) REFERENCES manifests(id);
ALTER TABLE trip_job ADD CONSTRAINT fk_trip_job_photo    FOREIGN KEY (photo_id)    REFERENCES photos(id);

-- ---------------------------------------------------------------------------
-- Shift roster. The PLANNED headcount. On-duty is already derivable from trips;
-- rostered is not, so without this "we ran two drivers short" stays an assertion
-- instead of a number -- and conceding our own shortfalls is what keeps a Lotus
-- claim credible.
-- ---------------------------------------------------------------------------
CREATE TABLE shift_roster (
    id            BIGINT      NOT NULL AUTO_INCREMENT,
    work_date     DATE        NOT NULL,
    warehouse_id  BIGINT      NOT NULL,
    driver_id     BIGINT      NOT NULL,
    shift         VARCHAR(32) NOT NULL DEFAULT 'full',
    created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_roster_driver_day (work_date, driver_id),
    KEY idx_roster_day_outlet (work_date, warehouse_id)
) DEFAULT CHARSET=utf8mb4;

ALTER TABLE shift_roster ADD CONSTRAINT fk_roster_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);
ALTER TABLE shift_roster ADD CONSTRAINT fk_roster_driver    FOREIGN KEY (driver_id)    REFERENCES users(id);

-- ---------------------------------------------------------------------------
-- Driver-app settings, so what the app asks for is configured rather than
-- hard-coded (job-count quick picks, which checkpoints demand a photo, whether
-- the photo carries a burned-in stamp, and so on).
-- ---------------------------------------------------------------------------
CREATE TABLE app_setting (
    setting_key  VARCHAR(64)  NOT NULL,
    value        VARCHAR(500) NOT NULL,
    notes        VARCHAR(300) NULL,
    updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (setting_key)
) DEFAULT CHARSET=utf8mb4;

INSERT INTO app_setting (setting_key, value, notes) VALUES
  ('job_count_quick_picks',   '4,5,6,7',   'Buttons on the "how many jobs" sheet'),
  ('job_count_manual_max',    '40',        'Upper bound on the typed job count'),
  ('allow_add_job_mid_trip',  'true',      'Driver may append a drop after loading'),
  ('photo_required_checkpoints', 'arrived,goods_ready,loaded,departed,returned', 'Checkpoints that refuse to stamp without a photo'),
  ('photo_burn_timestamp',    'true',      'Burn date and time into the image itself'),
  ('photo_timestamp_source',  'server',    'server | handset -- server is harder for Lotus to challenge'),
  ('photo_capture_gps',       'true',      'Record GPS alongside the photo'),
  ('reason_prompt_on_breach', 'true',      'Ask the driver why when a gap runs over target'),
  ('default_language',        'en',        'Driver can still switch to Bahasa Malaysia');

-- ---------------------------------------------------------------------------
-- New columns on existing tables. Every one is nullable or defaulted, so no
-- existing row is invalidated and nothing has to be backfilled to stay valid.
-- ---------------------------------------------------------------------------

-- A trip's explicit end-of-day close (basket and invoice returned), and the job
-- count the driver entered -- kept beside the actual count so "told 6, ran 8" is
-- reportable as a planning problem.
ALTER TABLE manifests ADD COLUMN day_closed_at DATETIME NULL;
ALTER TABLE manifests ADD COLUMN expected_job_count INT NULL;

-- An order now belongs to a job as well as to a trip. Nullable: every existing
-- order keeps working with no job, exactly as it does today.
ALTER TABLE delivery_jobs ADD COLUMN trip_job_id BIGINT NULL;
ALTER TABLE delivery_jobs ADD CONSTRAINT fk_delivery_jobs_trip_job FOREIGN KEY (trip_job_id) REFERENCES trip_job(id);

-- Per-order failures rank in the same league table as trip delays. The existing
-- free-text failure_reason is KEPT and stays populated -- this sits beside it.
ALTER TABLE delivery_events ADD COLUMN reason_code VARCHAR(48) NULL;
ALTER TABLE delivery_events ADD CONSTRAINT fk_events_reason FOREIGN KEY (reason_code) REFERENCES reason_code(code);

-- ---------------------------------------------------------------------------
-- Backfill. Every manifest that already recorded a warehouse arrival gets its
-- 'arrived' checkpoint, carrying the original timestamp, GPS and proof photo, so
-- historical trips open with their first checkpoint present instead of empty.
-- manifests.warehouse_arrived_at is left in place and keeps being written, so
-- nothing depending on it breaks.
-- ---------------------------------------------------------------------------
INSERT INTO trip_checkpoint (manifest_id, checkpoint, occurred_at, lat, lng, photo_id, created_by)
SELECT m.id, 'arrived', m.warehouse_arrived_at, m.warehouse_arrived_lat, m.warehouse_arrived_lng,
       m.warehouse_arrived_photo_id, m.driver_id
FROM manifests m
WHERE m.warehouse_arrived_at IS NOT NULL;
