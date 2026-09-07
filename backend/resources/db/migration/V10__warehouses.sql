-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
-- Multiple warehouse outlets, managed by admins; each driver is assigned to one.
--
-- "Remove" is a soft-delete (is_active = 0) in the application, not a DROP/DELETE --
-- a driver may already be assigned to an outlet, and hard-deleting it would either
-- violate the FK or silently orphan that assignment.
--
-- Column and its foreign key are added in separate statements (adding both in one
-- ALTER TABLE fails on OceanBase -- "Column not found", see deploy-contract.md).

CREATE TABLE warehouses (
    id          BIGINT       NOT NULL AUTO_INCREMENT,
    name        VARCHAR(255) NOT NULL,
    address     VARCHAR(512) NULL,
    is_active   TINYINT(1)   NOT NULL DEFAULT 1,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) DEFAULT CHARSET=utf8mb4;

-- A starting outlet so the signup dropdown isn't empty before an admin sets up the
-- real list; admins can rename it or add more from the new Warehouses admin page.
INSERT INTO warehouses (name) VALUES ('Main Warehouse');

ALTER TABLE users ADD COLUMN warehouse_id BIGINT NULL;
ALTER TABLE users ADD CONSTRAINT fk_users_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);
