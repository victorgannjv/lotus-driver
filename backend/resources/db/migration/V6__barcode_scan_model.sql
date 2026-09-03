-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
--
-- Replaces the manifest-photo-OCR flow with barcode scanning: a driver scans each
-- order's barcode to register it at pickup, and scans the same barcode again to mark
-- it delivered. A barcode is an exact, unambiguous identifier, so there's no more
-- OCR, fuzzy matching, orphan-event review, or photo evidence requirement.
--
-- This reshapes manifests/delivery_jobs/delivery_events enough that rows from the old
-- OCR-based flow don't fit the new columns. The app has no real driver data yet (only
-- test data from development), so those tables are cleared here rather than trying to
-- backfill rows that no longer have a sensible shape.
--
-- OceanBase's MySQL-compat mode rejects some multi-clause ALTER TABLE combinations
-- real MySQL accepts (e.g. dropping a foreign key and the index that backed it in the
-- same statement, error 5320) -- so this migration keeps to one logical change per
-- statement, which also fails atomically instead of half-applying a big combined ALTER.

DELETE FROM delivery_events;
DELETE FROM delivery_jobs;
DELETE FROM manifests;
DELETE FROM photos;

-- delivery_events: one row per scan (register or deliver). No more ambiguity between
-- "job the driver tapped" vs. "job OCR resolved to" -- a scan names its job directly.
ALTER TABLE delivery_events DROP FOREIGN KEY fk_events_selected_job;
ALTER TABLE delivery_events DROP FOREIGN KEY fk_events_photo;
ALTER TABLE delivery_events DROP FOREIGN KEY fk_events_resolved_by;

-- Dropping a column also drops any index defined solely on it (or removes it from a
-- composite index) -- no explicit DROP INDEX needed, now that the FKs above are gone.
ALTER TABLE delivery_events DROP COLUMN driver_selected_job_id;
ALTER TABLE delivery_events DROP COLUMN photo_id;
ALTER TABLE delivery_events DROP COLUMN ocr_candidate_text;
ALTER TABLE delivery_events DROP COLUMN match_type;
ALTER TABLE delivery_events DROP COLUMN needs_review;
ALTER TABLE delivery_events DROP COLUMN resolved_by;
ALTER TABLE delivery_events DROP COLUMN resolved_at;
ALTER TABLE delivery_events MODIFY COLUMN job_id BIGINT NOT NULL;

-- delivery_jobs: tracking_no is now the scanned barcode value itself (always
-- present), not an OCR guess. No more recipient/address -- drivers read those off
-- the paper manifest they're physically carrying.
ALTER TABLE delivery_jobs DROP COLUMN recipient_name;
ALTER TABLE delivery_jobs DROP COLUMN address;
ALTER TABLE delivery_jobs DROP COLUMN raw_ocr_json;
ALTER TABLE delivery_jobs MODIFY COLUMN tracking_no VARCHAR(128) NOT NULL;
ALTER TABLE delivery_jobs ADD UNIQUE KEY uq_jobs_manifest_tracking (manifest_id, tracking_no);

-- manifests: now just a driver's per-day scan session, created lazily on their first
-- register-scan of the day -- no photo, no OCR status.
ALTER TABLE manifests DROP FOREIGN KEY fk_manifests_photo;
ALTER TABLE manifests DROP COLUMN photo_id;
ALTER TABLE manifests DROP COLUMN ocr_status;
ALTER TABLE manifests DROP COLUMN ocr_error;
ALTER TABLE manifests DROP COLUMN ocr_raw_response;

-- photos existed only for manifest photos and delivery-order-slip evidence, both gone.
DROP TABLE photos;

-- statuses: 'requires_photo' no longer means anything. Replace pending/arrived/failed
-- with the two-scan-event model; 'cancelled' (session voided) and 'delivered' already
-- exist from V2 and just get re-ordered/kept.
ALTER TABLE statuses DROP COLUMN requires_photo;

DELETE FROM statuses WHERE code IN ('pending', 'arrived', 'failed');
INSERT INTO statuses (code, label, sort_order, is_terminal_success, is_active) VALUES
  ('registered', 'Registered', 0, 0, 1);
UPDATE statuses SET sort_order = 1 WHERE code = 'delivered';
UPDATE statuses SET sort_order = 2 WHERE code = 'cancelled';
