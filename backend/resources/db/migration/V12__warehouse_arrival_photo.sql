-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
-- Adds a required-at-the-API-level proof photo to "Arrived at warehouse" -- the
-- driver now has to snap a photo of where they are, alongside the GPS fix already
-- captured, before the job (manifest) is created. Nullable at the schema level
-- (existing rows predate this and have no photo) -- the app enforces "required"
-- by always uploading one on every new POST /api/manifests/start from here on.
--
-- Column and its foreign key are added in separate statements (adding both in one
-- ALTER TABLE fails on OceanBase -- "Column not found", see V9's note).

ALTER TABLE manifests ADD COLUMN warehouse_arrived_photo_id BIGINT NULL;
ALTER TABLE manifests ADD CONSTRAINT fk_manifests_arrival_photo FOREIGN KEY (warehouse_arrived_photo_id) REFERENCES photos(id);
