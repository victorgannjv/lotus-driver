-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
-- Records the moment a driver first taps "Scan orders" for the day as their
-- warehouse-arrival time (+ GPS), on the session (manifests) row. Idempotent by
-- design in the app code: only the first press of the day sets it, later presses
-- (e.g. returning to scan more later in the shift) leave it untouched.

ALTER TABLE manifests ADD COLUMN warehouse_arrived_at DATETIME NULL;
ALTER TABLE manifests ADD COLUMN warehouse_arrived_lat DECIMAL(10,7) NULL;
ALTER TABLE manifests ADD COLUMN warehouse_arrived_lng DECIMAL(10,7) NULL;
