-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
--
-- A checkpoint could hold exactly one photo, because the evidence lived in a
-- single `photo_id` column on the row it belonged to. That is one frame of a
-- loading bay: it cannot show the seal, the pallet and the invoice, and a driver
-- who took the wrong one had no second chance. Lotus disputes are argued from
-- these pictures, so being able to send three of them is the feature.
--
-- The existing `photo_id` columns are deliberately LEFT IN PLACE and still
-- written with the FIRST photo. Every admin screen, export and analytics query
-- that reads `photo_id` keeps working untouched; this table carries the full
-- set for the screens that want it. One mechanism to add, none to migrate.
--
-- Column and its foreign key are added in separate statements (adding both in
-- one ALTER TABLE fails on OceanBase -- "Column not found", see
-- deploy-contract.md).

CREATE TABLE trip_photo (
    id           BIGINT       NOT NULL AUTO_INCREMENT,
    -- Exactly one of (manifest_id + checkpoint) or trip_job_id identifies the
    -- thing photographed. Nullable rather than two tables: the read is always
    -- "every photo for this step", and one table answers it.
    manifest_id  BIGINT       NULL,
    checkpoint   VARCHAR(32)  NULL,
    trip_job_id  BIGINT       NULL,
    photo_id     BIGINT       NOT NULL,
    seq          INT          NOT NULL DEFAULT 1,
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_trip_photo_checkpoint (manifest_id, checkpoint),
    KEY ix_trip_photo_job (trip_job_id)
) DEFAULT CHARSET=utf8mb4;

ALTER TABLE trip_photo ADD CONSTRAINT fk_trip_photo_photo FOREIGN KEY (photo_id) REFERENCES photos(id);
ALTER TABLE trip_photo ADD CONSTRAINT fk_trip_photo_manifest FOREIGN KEY (manifest_id) REFERENCES manifests(id);
ALTER TABLE trip_photo ADD CONSTRAINT fk_trip_photo_job FOREIGN KEY (trip_job_id) REFERENCES trip_job(id);

-- Everything already stamped keeps its evidence visible in the new view, so the
-- app does not suddenly show today's trips with photos and yesterday's without.
INSERT INTO trip_photo (manifest_id, checkpoint, photo_id, seq, created_at)
SELECT manifest_id, checkpoint, photo_id, 1, occurred_at
  FROM trip_checkpoint WHERE photo_id IS NOT NULL;

INSERT INTO trip_photo (trip_job_id, photo_id, seq, created_at)
SELECT id, photo_id, 1, COALESCE(completed_at, NOW())
  FROM trip_job WHERE photo_id IS NOT NULL;
