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

DELETE FROM delivery_events;
DELETE FROM delivery_jobs;
DELETE FROM manifests;
DELETE FROM photos;

-- delivery_events: one row per scan (register or deliver). No more ambiguity between
-- "job the driver tapped" vs. "job OCR resolved to" -- a scan names its job directly.
ALTER TABLE delivery_events
    DROP FOREIGN KEY fk_events_selected_job,
    DROP FOREIGN KEY fk_events_photo,
    DROP FOREIGN KEY fk_events_resolved_by,
    DROP INDEX idx_events_selected_job,
    DROP INDEX idx_events_needs_review,
    DROP COLUMN driver_selected_job_id,
    DROP COLUMN photo_id,
    DROP COLUMN ocr_candidate_text,
    DROP COLUMN match_type,
    DROP COLUMN needs_review,
    DROP COLUMN resolved_by,
    DROP COLUMN resolved_at,
    MODIFY COLUMN job_id BIGINT NOT NULL;

-- delivery_jobs: tracking_no is now the scanned barcode value itself (always
-- present), not an OCR guess. No more recipient/address -- drivers read those off
-- the paper manifest they're physically carrying.
ALTER TABLE delivery_jobs
    DROP COLUMN recipient_name,
    DROP COLUMN address,
    DROP COLUMN raw_ocr_json,
    MODIFY COLUMN tracking_no VARCHAR(128) NOT NULL,
    ADD UNIQUE KEY uq_jobs_manifest_tracking (manifest_id, tracking_no);

-- manifests: now just a driver's per-day scan session, created lazily on their first
-- register-scan of the day -- no photo, no OCR status.
ALTER TABLE manifests
    DROP FOREIGN KEY fk_manifests_photo,
    DROP COLUMN photo_id,
    DROP COLUMN ocr_status,
    DROP COLUMN ocr_error,
    DROP COLUMN ocr_raw_response;

-- photos existed only for manifest photos and delivery-order-slip evidence, both gone.
DROP TABLE photos;

-- statuses: 'requires_photo' no longer means anything. Replace pending/arrived/failed
-- with the two-scan-event model; 'cancelled' (session voided) and 'delivered' already
-- exist from V2 and just get re-ordered/kept.
ALTER TABLE statuses
    DROP COLUMN requires_photo;

DELETE FROM statuses WHERE code IN ('pending', 'arrived', 'failed');
INSERT INTO statuses (code, label, sort_order, is_terminal_success, is_active) VALUES
  ('registered', 'Registered', 0, 0, 1);
UPDATE statuses SET sort_order = 1 WHERE code = 'delivered';
UPDATE statuses SET sort_order = 2 WHERE code = 'cancelled';
