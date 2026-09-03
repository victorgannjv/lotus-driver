-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
-- Reintroduces a 'failed' job status (dropped in the barcode-scan migration, which
-- only kept registered/delivered/cancelled) so a driver can record a delivery
-- attempt that didn't succeed, along with the reason.

INSERT INTO statuses (code, label, sort_order, is_terminal_success, is_active) VALUES
  ('failed', 'Failed', 2, 0, 1);
UPDATE statuses SET sort_order = 3 WHERE code = 'cancelled';

ALTER TABLE delivery_events ADD COLUMN failure_reason VARCHAR(500) NULL;
