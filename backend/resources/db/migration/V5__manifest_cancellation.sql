-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
-- Lets a driver cancel a wrongly-photographed/misread manifest and start over,
-- without losing the record (kept for the dispute-trace audit trail, not deleted).

ALTER TABLE manifests
    ADD COLUMN cancelled_at DATETIME NULL AFTER ocr_raw_response;
